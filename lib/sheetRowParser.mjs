// Shared row-parsing logic for anything reading the "Real Todays" Google Sheet tab:
// the sheet-sync webhook (app/api/sync/sheet/route.ts), the backstop poll, and (already,
// separately) the one-time June CSV import. The sheet uses the exact same positional column
// layout as that CSV export -- see scripts/import-june-orders.mjs for where this was lifted from.
import { resolveUrgencyTargetDay } from './urgencyTarget.mjs';

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

// Column C on "Real Todays Orders" is messier in practice than the original clean spec:
// staff mix urgency/confirmation markers with free-text operational notes, delimited by
// commas as often as spaces, in either order ("D31, C" and "C, VU1" both occur), e.g.
// "VU5 x1", "D12, C", "C, (Call before Dispatch)", "X3, No WA", "Cancel, (From M)".
const CONFIRMATION_MARKER_TO_STATUS = {
  x1: 'x1',
  x2: 'x2',
  x3: 'x3',
  c: 'confirmed_c',
  wa: 'confirmed_wa',
  m: 'confirmed_m',
  cancelled: 'cancelled',
  cancel: 'cancelled',
};

const CONFIRMATION_STATUS_TO_MARKER = {
  pending: '',
  x1: 'x1',
  x2: 'x2',
  x3: 'x3',
  confirmed_c: 'C',
  confirmed_wa: 'Wa',
  confirmed_m: 'M',
  cancelled: 'cancelled',
};

// Parses column C into urgency/confirmation/leftover-notes parts. Malformed pieces don't
// throw -- they're reported via `warnings` so the caller can leave the existing app value
// alone for that piece specifically, rather than aborting the whole row or the whole sync.
//
// Only the first two comma/space-delimited tokens are ever checked as markers, and scanning
// stops at the first token that isn't a recognized marker. This is deliberate: it's what
// prevents a stray marker-shaped word deep in a free-text note (e.g. "No **WA**" meaning
// "no WhatsApp", not "Confirmed (Wa)") from ever being misread as a status change. Everything
// from the first non-marker token onward -- including real notes like "merged with: NN-18268"
// or "(Call before Dispatch)" -- is preserved verbatim as leftoverText rather than discarded,
// since staff are clearly relying on this column for both status AND notes.
export function parseColumnC(raw, now = new Date()) {
  const trimmed = (raw ?? '').toString().trim();
  const warnings = [];

  if (!trimmed) {
    return { urgencyType: 'normal', urgencyTargetDate: null, urgencyMalformed: false, confirmationStatus: 'pending', leftoverText: null, warnings };
  }

  const rawTokens = trimmed.split(/[,\s]+/).filter(Boolean);
  const stripParens = (t) => t.replace(/^[(]+|[)]+$/g, '');

  let urgencyType = 'normal';
  let urgencyTargetDate = null;
  let urgencyMalformed = false;
  let confirmationStatus = null;
  let consumed = 0;

  for (let i = 0; i < Math.min(2, rawTokens.length); i++) {
    const token = stripParens(rawTokens[i]);

    const urgencyMatch = !urgencyMalformed && urgencyType === 'normal' ? token.match(/^(VU|D)(\d{1,2})$/i) : null;
    if (urgencyMatch) {
      const type = urgencyMatch[1].toLowerCase();
      const day = parseInt(urgencyMatch[2], 10);
      const resolved = resolveUrgencyTargetDay(day, now);
      if ('error' in resolved) {
        urgencyMalformed = true;
        warnings.push(`urgency marker "${token}" invalid: ${resolved.error}`);
      } else {
        urgencyType = type;
        urgencyTargetDate = resolved.date;
      }
      consumed = i + 1;
      continue;
    }

    const key = token.toLowerCase();
    if (confirmationStatus === null && Object.prototype.hasOwnProperty.call(CONFIRMATION_MARKER_TO_STATUS, key)) {
      confirmationStatus = CONFIRMATION_MARKER_TO_STATUS[key];
      consumed = i + 1;
      continue;
    }

    // first token that isn't a recognized marker -- stop scanning, everything from here is notes
    break;
  }

  if (confirmationStatus === null) {
    confirmationStatus = 'pending';
  }

  const leftoverText = rawTokens.slice(consumed).join(' ').trim() || null;

  return { urgencyType, urgencyTargetDate, urgencyMalformed, confirmationStatus, leftoverText, warnings };
}

// Inverse of parseColumnC -- reconstructs the full cell string from current app state.
// urgent/hold (the older static urgency types) have no representation in this format, same
// as "normal": only vu/d produce a visible urgency segment. Note this does NOT reconstruct
// leftoverText/notes -- app -> sheet write-back only ever writes the status markers, never
// touches whatever free-text a moderator already has in that cell beyond them (see
// app/api/orders/route.ts's write-back, which reconstructs only the marker portion).
export function buildColumnC(urgencyType, urgencyTargetDate, confirmationStatus) {
  const urgencyMarker = (urgencyType === 'vu' || urgencyType === 'd') && urgencyTargetDate
    ? `${urgencyType.toUpperCase()}${new Date(urgencyTargetDate).getUTCDate()}`
    : '';
  const confirmationMarker = CONFIRMATION_STATUS_TO_MARKER[confirmationStatus] ?? '';
  return [urgencyMarker, confirmationMarker].filter(Boolean).join(' ');
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
  const columnC = c(2); // urgency + confirmation marker (+ notes) -- see parseColumnC
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

  const parsedColumnC = parseColumnC(columnC, now);
  const returnFlagged = isReturnExchange(orderNumber, parsedColumnC.leftoverText || '');

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
    total_amount: Number.isFinite(billAmount) ? billAmount : null,
    special_instructions: parsedColumnC.leftoverText,
    cancel_return_reason: returnFlagged ? parsedColumnC.leftoverText : null,
    items,
    // parsed from column C -- confirmationStatus is always definite (defaults to 'pending' if
    // no marker is found, per spec: "empty/blank = pending"); urgencyMalformed is true if a
    // VU/D-shaped token failed day resolution, in which case reconcileSheetRows.ts falls back
    // to defaults.urgency_type instead of applying it
    parsedUrgencyType: parsedColumnC.urgencyType,
    parsedUrgencyTargetDate: parsedColumnC.urgencyTargetDate,
    urgencyMalformed: parsedColumnC.urgencyMalformed,
    parsedConfirmationStatus: parsedColumnC.confirmationStatus,
    columnCWarnings: parsedColumnC.warnings,
    // only urgency_type/delivery_status ever fall back to these (see above) -- confirmation
    // always comes from column C now, sheet is authoritative even on creation
    defaults: {
      urgency_type: 'normal',
      // sheet orders are today's live orders, not the historical/already-fulfilled June
      // import, so "packaging" (not "delivered") is the right just-created default
      delivery_status: returnFlagged ? 'returned' : 'packaging',
    },
  };
}
