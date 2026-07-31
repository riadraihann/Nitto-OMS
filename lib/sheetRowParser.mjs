// Shared row-parsing logic for anything reading the "Real Todays" Google Sheet tab:
// the sheet-sync webhook (app/api/sync/sheet/route.ts), the backstop poll, and (already,
// separately) the one-time June CSV import. The sheet uses the exact same positional column
// layout as that CSV export -- see scripts/import-june-orders.mjs for where this was lifted from.
import { defaultConfirmationStatus } from './orderDefaults.mjs';

export function parseTimestamp(raw) {
  const s = (raw ?? '').toString().trim();
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
    const date = new Date(utcMs - 6 * 3600000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // fallback: native ISO-8601, e.g. what a Sheets-API/Apps-Script Date-typed cell serializes to
  // over JSON ("2026-07-26T14:42:27.000Z") when the column isn't stored as plain text
  const isoDate = new Date(s);
  return Number.isNaN(isoDate.getTime()) ? null : isoDate.toISOString();
}

export function cleanPhone(raw) {
  return (raw ?? '').toString().trim().replace(/^[`']+/, '');
}

export function detectSource(orderNumber) {
  const s = orderNumber.trim().toUpperCase();
  if (s.startsWith('NN')) return 'shopify';
  if (s.startsWith('SC')) return 'social';
  if (s.startsWith('OTC')) return 'otc';
  return null;
}

export function isReturnExchange(orderNumber, notes) {
  const text = `${orderNumber} ${notes}`.toLowerCase();
  return /exchange|return/.test(text);
}

// Parses one sheet row (array of cell values, as returned by the Sheets API / Apps Script
// getValues()) into an order-shaped object, or returns { error: reason } if the row should
// be skipped (blank, missing required fields, no valid items).
//
// `now` controls the default confirmation_status computation on new orders (age-based for
// Shopify orders) -- pass a fixed Date in tests for determinism.
export function parseSheetRow(cols, now = new Date()) {
  const c = (i) => (cols[i] ?? '').toString().trim();

  const orderNumber = c(1);
  if (!orderNumber) {
    return { error: 'blank row (no order id)' };
  }

  const createdAt = parseTimestamp(c(0));
  const notes = c(2);
  const customerName = c(3);
  const phone = cleanPhone(c(4));
  const address = c(5);
  // col6 city, col7 zone code, col8 blank, col9 payment method -- not stored, same as CSV import

  if (!createdAt || !customerName || !phone || !address) {
    return { error: 'missing required field (date/customer/phone/address)' };
  }

  let source = detectSource(orderNumber);
  if (!source) {
    source = 'social'; // fallback for legacy numeric-only IDs, matches CSV import behavior
  }

  const returnFlagged = isReturnExchange(orderNumber, notes);

  const items = [];
  for (let i = 11; i < cols.length; i += 2) {
    const name = (cols[i] ?? '').toString().trim();
    const qtyRaw = (cols[i + 1] ?? '').toString().trim();
    if (!name && !qtyRaw) continue;
    const qty = parseInt(qtyRaw, 10);
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    items.push({ sku: '', product_name: name, quantity: qty, unit_price: 0 });
  }

  if (items.length === 0) {
    return { error: 'no valid items' };
  }

  const billAmount = parseFloat(c(10));

  return {
    order_number: orderNumber,
    created_at: createdAt,
    order_source: source,
    customer_name: customerName,
    phone,
    address,
    special_instructions: notes || null,
    cancel_return_reason: returnFlagged ? (notes || null) : null,
    total_amount: Number.isFinite(billAmount) ? billAmount : null,
    items,
    // only used when creating a brand-new order -- updates never touch these, see route.ts
    defaults: {
      urgency_status: 'normal',
      confirmation_status: defaultConfirmationStatus(source, new Date(createdAt || now)),
      // sheet orders are today's live orders, not the historical/already-fulfilled June
      // import, so "packaging" (not "delivered") is the right just-created default
      delivery_status: returnFlagged ? 'returned' : 'packaging',
    },
  };
}
