// One-time backfill: populate orders.total_amount from the original June CSV bill amount,
// then split that total equally across each order's items to replace the placeholder
// unit_price=0 values set during the original import.
//
// This relies on the June import having inserted rows in the exact same order the CSV
// rows were parsed in (see scripts/import-june-orders.mjs), so we can zip the freshly
// re-parsed CSV orders positionally against the DB orders (order_number IS NOT NULL,
// ordered by id ASC). order_number/timestamp alone aren't reliably unique (e.g. "otc" is
// a shared placeholder, and a few legitimate orders share the same order_number+timestamp
// with different items), so positional zip plus an order_number sanity check is the safe path.
//
// Usage:
//   node scripts/backfill-order-totals.mjs --dry-run
//   node scripts/backfill-order-totals.mjs --execute

import { createClient } from '@supabase/supabase-js';
import { buildOrders } from './import-june-orders.mjs';

const mode = process.argv.includes('--execute') ? 'execute' : 'dry-run';

function requireClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in env');
  return createClient(url, key);
}

// Bulk updates use raw SQL via the Management API rather than supabase-js .upsert(), because
// PostgREST upsert builds a real INSERT ... ON CONFLICT DO UPDATE, which validates NOT NULL
// constraints (e.g. orders.order_source) against the INSERT branch even though every row here
// already exists and we only intend to update two columns.
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

async function bulkUpdateNumericColumn({ table, column, rows }) {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((r) => `(${r.id}, ${r.value})`).join(', ');
    const sql = `update public.${table} as t set ${column} = v.${column} from (values ${values}) as v(id, ${column}) where t.id = v.id;`;
    await runManagementSql(sql);
    console.log(`  ${table}.${column} updated: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
}

async function fetchDbOrders(supabase) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number')
      .not('order_number', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetching orders failed: ${error.message}`);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function fetchDbItems(supabase) {
  // Fetch ALL order_items with proper .range() pagination -- PostgREST silently caps
  // unpaginated (or under-chunked) responses at its default max-rows, so any single
  // request here must be range-paginated rather than relying on .in()-chunk size alone.
  const PAGE = 1000;
  const itemsByOrderId = new Map();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, order_id, quantity')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetching order_items failed: ${error.message}`);
    for (const row of data) {
      if (!itemsByOrderId.has(row.order_id)) itemsByOrderId.set(row.order_id, []);
      itemsByOrderId.get(row.order_id).push(row);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return itemsByOrderId;
}

async function main() {
  const { orders: csvOrders } = buildOrders();
  const supabase = requireClient();

  const dbOrders = await fetchDbOrders(supabase);
  if (dbOrders.length !== csvOrders.length) {
    throw new Error(
      `positional zip precondition failed: DB has ${dbOrders.length} orders with order_number set, CSV re-parse produced ${csvOrders.length}. Refusing to guess -- investigate before proceeding.`
    );
  }

  const dbItemsByOrderId = await fetchDbItems(supabase);

  const orderUpdates = [];
  const itemUpdates = [];
  const mismatches = [];
  const missingTotal = [];
  const itemCountMismatches = [];

  for (let i = 0; i < dbOrders.length; i++) {
    const dbOrder = dbOrders[i];
    const csvOrder = csvOrders[i];

    if (dbOrder.order_number !== csvOrder.order_number) {
      mismatches.push({ index: i, dbOrderId: dbOrder.id, dbOrderNumber: dbOrder.order_number, csvOrderNumber: csvOrder.order_number, csvRow: csvOrder.row });
      continue;
    }

    if (csvOrder.total_amount == null || !(csvOrder.total_amount >= 0)) {
      missingTotal.push({ dbOrderId: dbOrder.id, orderNumber: dbOrder.order_number, row: csvOrder.row });
      continue;
    }

    const dbItems = dbItemsByOrderId.get(dbOrder.id) ?? [];
    if (dbItems.length !== csvOrder.items.length) {
      itemCountMismatches.push({
        dbOrderId: dbOrder.id,
        orderNumber: dbOrder.order_number,
        dbItemCount: dbItems.length,
        csvItemCount: csvOrder.items.length,
      });
      continue;
    }

    orderUpdates.push({ id: dbOrder.id, total_amount: csvOrder.total_amount });

    const perItemSubtotal = csvOrder.total_amount / dbItems.length;
    dbItems.forEach((dbItem, itemIndex) => {
      const csvQty = csvOrder.items[itemIndex].quantity;
      if (dbItem.quantity !== csvQty) {
        itemCountMismatches.push({
          dbOrderId: dbOrder.id,
          orderNumber: dbOrder.order_number,
          reason: `quantity mismatch at item ${itemIndex}: db=${dbItem.quantity} csv=${csvQty}`,
        });
        return;
      }
      const unitPrice = dbItem.quantity > 0 ? perItemSubtotal / dbItem.quantity : 0;
      itemUpdates.push({ id: dbItem.id, unit_price: Math.round(unitPrice * 100) / 100 });
    });
  }

  console.log('=== Backfill summary ===');
  console.log('DB orders (order_number set):', dbOrders.length);
  console.log('order_number mismatches (positional zip broke):', mismatches.length);
  if (mismatches.length) console.log('  samples:', JSON.stringify(mismatches.slice(0, 5), null, 2));
  console.log('Orders with no usable CSV total_amount:', missingTotal.length);
  if (missingTotal.length) console.log('  samples:', JSON.stringify(missingTotal.slice(0, 5), null, 2));
  console.log('Item count/quantity mismatches:', itemCountMismatches.length);
  if (itemCountMismatches.length) console.log('  samples:', JSON.stringify(itemCountMismatches.slice(0, 5), null, 2));
  console.log('Orders to update with total_amount:', orderUpdates.length);
  console.log('Items to update with unit_price:', itemUpdates.length);
  console.log('\nSample order updates:', JSON.stringify(orderUpdates.slice(0, 3), null, 2));
  console.log('Sample item updates:', JSON.stringify(itemUpdates.slice(0, 5), null, 2));

  if (mismatches.length > 0) {
    console.error('\nRefusing to proceed: positional zip assumption broke. Aborting before any writes.');
    process.exit(1);
  }

  if (mode !== 'execute') {
    console.log('\n(dry run only, no writes performed. Re-run with --execute to write.)');
    return;
  }

  console.log('\n=== Executing updates against Supabase (raw SQL, batched) ===');

  await bulkUpdateNumericColumn({
    table: 'orders',
    column: 'total_amount',
    rows: orderUpdates.map((u) => ({ id: u.id, value: u.total_amount })),
  });

  await bulkUpdateNumericColumn({
    table: 'order_items',
    column: 'unit_price',
    rows: itemUpdates.map((u) => ({ id: u.id, value: u.unit_price })),
  });

  console.log('\nDone.');
}

await main();
