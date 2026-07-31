// One-time import of June's Google Sheets CSV export into orders + order_items.
// Usage:
//   node scripts/import-june-orders.mjs --dry-run   (parse + validate only, no network writes)
//   node scripts/import-june-orders.mjs --execute    (actually insert into Supabase)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { defaultConfirmationStatus } from '../lib/orderDefaults.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'wjunw.csv');

const mode = process.argv.includes('--execute') ? 'execute' : 'dry-run';

// ---------- RFC4180 CSV parser (handles quoted fields, embedded commas/newlines, "" escaping) ----------
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
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // last field/row (file may or may not end with newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------- helpers ----------
function isDividerOrEmptyRow(cols) {
  const nonEmpty = cols.filter((c) => c.trim() !== '').length;
  return nonEmpty <= 1;
}

function parseTimestamp(raw) {
  const s = raw.trim();
  if (!s) return null;

  // "2026-06-02 18:12" | "2026-06-01 22:16:16 +0600"
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?(?: ([+-]\d{4}))?$/);
  if (m) {
    const [, y, mo, d, h, mi, sec, tz] = m;
    const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : '+06:00'; // default Asia/Dhaka
    const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec ?? '00'}${offset}`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // "6/30/2026 19:28:54" (M/D/YYYY H:MM:SS, no timezone -> assume Asia/Dhaka)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, mo, d, y, h, mi, sec] = m;
    const date = new Date(
      `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${sec}+06:00`
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // bare Excel/Sheets serial date-time, e.g. "46206.7427" (days since 1899-12-30, sheet-local time)
  m = s.match(/^\d{4,6}(?:\.\d+)?$/);
  if (m) {
    const serial = parseFloat(s);
    const epochMs = Date.UTC(1899, 11, 30);
    const utcMs = epochMs + serial * 86400000;
    // the serial encodes sheet-local (Asia/Dhaka, UTC+6) wall time; convert to true UTC instant
    const date = new Date(utcMs - 6 * 3600000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function cleanPhone(raw) {
  return raw.trim().replace(/^[`']+/, '');
}

function detectSource(orderNumber) {
  const s = orderNumber.trim().toUpperCase();
  if (s.startsWith('NN')) return 'shopify';
  if (s.startsWith('SC')) return 'social';
  if (s.startsWith('OTC')) return 'otc';
  return null; // unmatched, caller decides fallback
}

function isReturnExchange(orderNumber, notes) {
  const text = `${orderNumber} ${notes}`.toLowerCase();
  return /exchange|return/.test(text);
}

// ---------- main parse+build ----------
function buildOrders() {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const allRows = parseCsv(raw);

  const skippedDividerOrEmpty = [];
  const dataRows = [];
  allRows.forEach((cols, idx) => {
    if (isDividerOrEmptyRow(cols)) {
      skippedDividerOrEmpty.push(idx);
    } else {
      dataRows.push({ idx, cols });
    }
  });

  const orders = [];
  const unmatchedSourcePrefixes = [];
  const validationErrors = [];
  const outOfRangeDates = [];
  const likelyDuplicateRows = [];
  const seenContentKeys = new Map();

  for (const { idx, cols } of dataRows) {
    const c = (i) => (cols[i] ?? '').trim();

    const createdAt = parseTimestamp(c(0));
    const orderNumber = c(1);
    const notes = c(2);
    const customerName = c(3);
    const phone = cleanPhone(c(4));
    const address = c(5);
    // col6 city, col7 zone code, col8 blank, col9 payment method -- intentionally dropped

    if (!createdAt || !orderNumber || !customerName || !phone || !address) {
      validationErrors.push({
        row: idx,
        reason: 'missing required field',
        createdAt,
        orderNumber,
        customerName,
        phone,
        address,
      });
      continue;
    }

    let source = detectSource(orderNumber);
    if (!source) {
      unmatchedSourcePrefixes.push({ row: idx, orderNumber });
      source = 'social'; // fallback for legacy numeric-only IDs
    }

    const returnFlagged = isReturnExchange(orderNumber, notes);

    // item/qty pairs start at col 11, alternating name, qty, to end of row
    const items = [];
    for (let i = 11; i < cols.length; i += 2) {
      const name = (cols[i] ?? '').trim();
      const qtyRaw = (cols[i + 1] ?? '').trim();
      if (!name && !qtyRaw) continue;
      const qty = parseInt(qtyRaw, 10);
      if (!name || !Number.isFinite(qty) || qty <= 0) {
        validationErrors.push({
          row: idx,
          reason: 'malformed item/qty pair',
          orderNumber,
          name,
          qtyRaw,
        });
        continue;
      }
      items.push({ sku: '', product_name: name, quantity: qty, unit_price: 0 });
    }

    if (items.length === 0) {
      validationErrors.push({ row: idx, reason: 'no valid items', orderNumber });
      continue;
    }

    // content-based duplicate detection (order_number alone isn't guaranteed unique, e.g. "otc" is
    // reused as a generic placeholder for walk-in sales) -- exact repeats are dropped, keeping the first
    const contentKey = [orderNumber, createdAt, customerName, phone, items.map((i) => `${i.product_name}x${i.quantity}`).join('|')].join('::');
    if (seenContentKeys.has(contentKey)) {
      likelyDuplicateRows.push({ row: idx, alsoRow: seenContentKeys.get(contentKey), orderNumber });
      continue;
    }
    seenContentKeys.set(contentKey, idx);

    // June-only import: rows whose created_at falls outside June 2026 are excluded
    if (createdAt < '2026-06-01' || createdAt >= '2026-07-01') {
      outOfRangeDates.push({ row: idx, orderNumber, createdAt });
      continue;
    }

    const billAmount = parseFloat(c(10));

    orders.push({
      row: idx,
      order_number: orderNumber,
      created_at: createdAt,
      order_source: source,
      customer_name: customerName,
      phone,
      address,
      urgency_status: 'normal',
      confirmation_status: defaultConfirmationStatus(source, new Date(createdAt)),
      delivery_status: returnFlagged ? 'returned' : 'delivered',
      special_instructions: notes || null,
      cancel_return_reason: returnFlagged ? notes || null : null,
      happiness_score: null,
      product_suggestions: null,
      total_amount: Number.isFinite(billAmount) ? billAmount : null,
      items,
    });
  }

  return { orders, skippedDividerOrEmpty, unmatchedSourcePrefixes, validationErrors, outOfRangeDates, likelyDuplicateRows, totalRows: allRows.length };
}

export { buildOrders, CSV_PATH };

function printSummary({ orders, skippedDividerOrEmpty, unmatchedSourcePrefixes, validationErrors, outOfRangeDates, likelyDuplicateRows, totalRows }) {
  const bySource = {};
  let returnCount = 0;
  let totalItems = 0;
  for (const o of orders) {
    bySource[o.order_source] = (bySource[o.order_source] ?? 0) + 1;
    if (o.delivery_status === 'returned') returnCount += 1;
    totalItems += o.items.length;
  }

  console.log('=== Import summary ===');
  console.log('CSV rows total:', totalRows);
  console.log('Divider/empty rows skipped:', skippedDividerOrEmpty.length);
  console.log('Orders to insert:', orders.length);
  console.log('Order_items to insert:', totalItems);
  console.log('By order_source:', bySource);
  console.log('Flagged returned/exchange orders:', returnCount);
  console.log('Unmatched source-prefix rows (fell back to social):', unmatchedSourcePrefixes.length);
  if (unmatchedSourcePrefixes.length) {
    console.log('  samples:', unmatchedSourcePrefixes.slice(0, 5));
  }
  console.log('Validation errors / skipped rows:', validationErrors.length);
  if (validationErrors.length) {
    console.log('  all:', JSON.stringify(validationErrors, null, 2));
  }
  console.log('Orders with created_at outside June 2026:', outOfRangeDates.length);
  if (outOfRangeDates.length) {
    console.log('  all:', JSON.stringify(outOfRangeDates, null, 2));
  }
  console.log('Likely accidental duplicate rows (identical order_number+date+customer+items):', likelyDuplicateRows.length);
  if (likelyDuplicateRows.length) {
    console.log('  all:', JSON.stringify(likelyDuplicateRows, null, 2));
  }

  console.log('\n=== First 3 orders (with items) ===');
  console.log(JSON.stringify(orders.slice(0, 3), null, 2));

  console.log('\n=== Sample of 3 returned/exchange orders ===');
  console.log(JSON.stringify(orders.filter((o) => o.delivery_status === 'returned').slice(0, 3), null, 2));
}

async function execute(orders) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in env');
  const supabase = createClient(url, key);

  const CHUNK = 500;
  let insertedOrders = 0;
  let insertedItems = 0;

  for (let i = 0; i < orders.length; i += CHUNK) {
    const chunk = orders.slice(i, i + CHUNK);
    const orderRows = chunk.map(({ items, row, ...rest }) => rest);
    // Postgres INSERT...RETURNING preserves input row order, so we zip positionally rather than
    // matching by order_number (order_number is not guaranteed unique -- e.g. "otc" is a shared
    // placeholder for walk-in sales across different customers).
    const { data, error } = await supabase.from('orders').insert(orderRows).select('id');
    if (error) throw new Error(`orders insert failed at chunk starting row ${chunk[0].row}: ${error.message}`);
    if (data.length !== chunk.length) throw new Error(`insert returned ${data.length} rows, expected ${chunk.length}`);

    const itemRows = [];
    chunk.forEach((o, i2) => {
      const orderId = data[i2].id;
      for (const item of o.items) {
        itemRows.push({ order_id: orderId, ...item });
      }
    });

    for (let j = 0; j < itemRows.length; j += CHUNK) {
      const itemChunk = itemRows.slice(j, j + CHUNK);
      const { error: itemErr } = await supabase.from('order_items').insert(itemChunk);
      if (itemErr) throw new Error(`order_items insert failed: ${itemErr.message}`);
      insertedItems += itemChunk.length;
    }

    insertedOrders += orderRows.length;
    console.log(`Inserted ${insertedOrders}/${orders.length} orders, ${insertedItems} items so far...`);
  }

  console.log(`\nDone. Inserted ${insertedOrders} orders and ${insertedItems} order_items.`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  const result = buildOrders();
  printSummary(result);

  if (mode === 'execute') {
    console.log('\n=== Executing real insert against Supabase ===');
    await execute(result.orders);
  } else {
    console.log('\n(dry run only, no writes performed. Re-run with --execute to insert.)');
  }
}
