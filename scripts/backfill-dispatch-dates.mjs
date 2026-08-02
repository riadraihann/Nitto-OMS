// One-time backfill: populate delivered_date (and courier_handoff_date, where applicable) for
// orders from the June CSV import, using the original file's date-only header rows as dispatch-
// batch boundaries (every order row beneath one, until the next, belongs to that date's batch) --
// see supabase/add_dispatch_dates.sql for why this is needed instead of created_at.
//
// Reuses the exact same positional-zip technique as scripts/backfill-order-totals.mjs: the June
// import inserted rows in the same order the CSV was parsed in, so re-parsing the CSV and zipping
// it against the DB orders (in id order) recovers the correspondence, with an order_number sanity
// check per pair to catch any drift. Unlike that script, this one scopes the DB side to
// synced_from_sheet_at IS NULL -- live sheet-synced orders have accumulated since the original
// import ran, so "every order with order_number set" is no longer just the June batch.
//
// Usage:
//   node scripts/backfill-dispatch-dates.mjs --dry-run
//   node scripts/backfill-dispatch-dates.mjs --execute

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { buildOrders, CSV_PATH } from './import-june-orders.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv.includes('--execute') ? 'execute' : 'dry-run';

function requireClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in env');
  return createClient(url, key);
}

async function runManagementSql(query) {
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!projectRef || !accessToken) throw new Error('Missing SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN in env');

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`management SQL failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function bulkUpdateTimestampColumn({ column, rows }) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((r) => `(${r.id}, '${r.value}'::timestamptz)`).join(', ');
    const sql = `update public.orders as t set ${column} = v.${column} from (values ${values}) as v(id, ${column}) where t.id = v.id;`;
    await runManagementSql(sql);
    console.log(`  orders.${column} updated: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
}

async function fetchJuneImportDbOrders(supabase) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, delivery_status, courier_handoff_date, delivered_date')
      .is('synced_from_sheet_at', null)
      .not('order_number', 'is', null)
      .gte('created_at', '2026-06-01')
      .lt('created_at', '2026-07-01')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetching orders failed: ${error.message}`);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ---------- reconstruct the date-header -> batch mapping from the raw CSV ----------
// Same RFC4180 parser as import-june-orders.mjs (duplicated locally to read the raw row
// structure, including the date-header rows buildOrders() itself discards).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += c; i += 1;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function isDateHeaderRow(cols) {
  const nonEmpty = cols.map((c, i) => [i, c.trim()]).filter(([, c]) => c !== '');
  if (nonEmpty.length !== 1 || nonEmpty[0][0] !== 0) return false;
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(nonEmpty[0][1]);
}

// Header dates are inconsistently M/D/YY vs D/M/YY (staff free-typed them). Disambiguate by
// picking whichever valid interpretation is closest going forward from the previous resolved
// date -- dispatch batches are daily-ish, so the correct reading is always the near one.
function parseBothWays(raw) {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  const [, a, b, yRaw] = m;
  const year = yRaw.length === 2 ? 2000 + parseInt(yRaw, 10) : parseInt(yRaw, 10);
  const candidates = [];
  if (parseInt(a, 10) >= 1 && parseInt(a, 10) <= 12 && parseInt(b, 10) >= 1 && parseInt(b, 10) <= 31) {
    candidates.push({ label: 'M/D', date: `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}` });
  }
  if (parseInt(b, 10) >= 1 && parseInt(b, 10) <= 12 && parseInt(a, 10) >= 1 && parseInt(a, 10) <= 31 && a !== b) {
    candidates.push({ label: 'D/M', date: `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}` });
  }
  return candidates;
}

function buildBatchDateByRow() {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const allRows = parseCsv(raw);

  const headers = [];
  allRows.forEach((cols, idx) => {
    if (isDateHeaderRow(cols)) headers.push({ idx, raw: cols[0].trim() });
  });

  let prevDate = '2026-06-01'; // anchor: the day before the known import window starts
  const resolved = [];
  for (const h of headers) {
    const candidates = parseBothWays(h.raw);
    const forward = candidates.filter((c) => c.date > prevDate);
    const chosen = forward.length > 0 ? forward.reduce((best, c) => (c.date < best.date ? c : best), forward[0]) : candidates[0];
    resolved.push({ idx: h.idx, resolvedDate: chosen.date });
    prevDate = chosen.date;
  }

  // sanity: every header strictly after the previous -- if this ever fails, the heuristic above
  // has broken down and needs a human to look at the raw headers again before trusting the output
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i].resolvedDate <= resolved[i - 1].resolvedDate) {
      throw new Error(`date-header sequence not strictly increasing at row ${resolved[i].idx} (${resolved[i].resolvedDate} <= ${resolved[i - 1].resolvedDate}) -- aborting, don't trust the batch mapping`);
    }
  }

  // map every row index to the most recent header's resolved date
  const batchDateByRow = new Map();
  for (let r = 0; r < allRows.length; r++) {
    let current = null;
    for (const h of resolved) {
      if (h.idx <= r) current = h.resolvedDate;
      else break;
    }
    if (current) batchDateByRow.set(r, current);
  }

  return { batchDateByRow, headerCount: headers.length, span: [resolved[0]?.resolvedDate, resolved[resolved.length - 1]?.resolvedDate] };
}

async function main() {
  const { orders: csvOrders } = buildOrders();
  const { batchDateByRow, headerCount, span } = buildBatchDateByRow();
  console.log(`Reconstructed ${headerCount} date-header batches, spanning ${span[0]} .. ${span[1]}`);

  const supabase = requireClient();
  const dbOrders = await fetchJuneImportDbOrders(supabase);

  console.log(`\nDB orders (June-import cohort: synced_from_sheet_at IS NULL, order_number set, created_at in June 2026): ${dbOrders.length}`);
  console.log(`CSV-reparsed orders: ${csvOrders.length}`);

  if (dbOrders.length !== csvOrders.length) {
    throw new Error(
      `positional zip precondition failed: DB cohort has ${dbOrders.length} orders, CSV re-parse produced ${csvOrders.length}. Refusing to guess -- investigate before proceeding.`
    );
  }

  const courierUpdates = [];
  const deliveredUpdates = [];
  const mismatches = [];
  const noBatchDate = [];
  const skippedNotHistory = [];
  const alreadySet = [];

  for (let i = 0; i < dbOrders.length; i++) {
    const dbOrder = dbOrders[i];
    const csvOrder = csvOrders[i];

    if (dbOrder.order_number !== csvOrder.order_number) {
      mismatches.push({ index: i, dbOrderId: dbOrder.id, dbOrderNumber: dbOrder.order_number, csvOrderNumber: csvOrder.order_number, csvRow: csvOrder.row });
      continue;
    }

    if (!['sent_to_courier', 'delivered'].includes(dbOrder.delivery_status)) {
      skippedNotHistory.push({ dbOrderId: dbOrder.id, delivery_status: dbOrder.delivery_status });
      continue;
    }

    const batchDate = batchDateByRow.get(csvOrder.row);
    if (!batchDate) {
      noBatchDate.push({ dbOrderId: dbOrder.id, csvRow: csvOrder.row });
      continue;
    }
    const timestamp = `${batchDate}T12:00:00+06:00`;

    if (dbOrder.delivery_status === 'delivered') {
      if (dbOrder.delivered_date) { alreadySet.push(dbOrder.id); continue; }
      deliveredUpdates.push({ id: dbOrder.id, value: timestamp });
    } else {
      if (dbOrder.courier_handoff_date) { alreadySet.push(dbOrder.id); continue; }
      courierUpdates.push({ id: dbOrder.id, value: timestamp });
    }
  }

  console.log('\n=== Backfill summary ===');
  console.log('order_number mismatches (positional zip broke):', mismatches.length);
  if (mismatches.length) console.log('  samples:', JSON.stringify(mismatches.slice(0, 5), null, 2));
  console.log('Skipped (not currently sent_to_courier/delivered):', skippedNotHistory.length);
  console.log('No batch date resolved (row before first header -- should be 0):', noBatchDate.length);
  if (noBatchDate.length) console.log('  samples:', JSON.stringify(noBatchDate.slice(0, 5), null, 2));
  console.log('Already had a dispatch date set (skipped, not overwritten):', alreadySet.length);
  console.log('delivered_date updates to write:', deliveredUpdates.length);
  console.log('courier_handoff_date updates to write:', courierUpdates.length);
  console.log('\nSample delivered_date updates:', JSON.stringify(deliveredUpdates.slice(0, 5), null, 2));
  console.log('Sample courier_handoff_date updates:', JSON.stringify(courierUpdates.slice(0, 5), null, 2));

  if (mismatches.length > 0) {
    console.error('\nRefusing to proceed: positional zip assumption broke. Aborting before any writes.');
    process.exit(1);
  }

  if (mode !== 'execute') {
    console.log('\n(dry run only, no writes performed. Re-run with --execute to write.)');
    return;
  }

  console.log('\n=== Executing updates against Supabase (raw SQL, batched) ===');
  if (deliveredUpdates.length) await bulkUpdateTimestampColumn({ column: 'delivered_date', rows: deliveredUpdates });
  if (courierUpdates.length) await bulkUpdateTimestampColumn({ column: 'courier_handoff_date', rows: courierUpdates });
  console.log('\nDone.');
}

await main();
