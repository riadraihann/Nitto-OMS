// Shared row-parsing logic for anything reading the "Real Todays" Google Sheet tab:
// the sheet-sync webhook (app/api/sync/sheet/route.ts), the backstop poll, and (already,
// separately) the one-time June CSV import. The sheet uses the exact same positional column
// layout as that CSV export -- see scripts/import-june-orders.mjs for where this was lifted from.
import { resolveUrgencyTargetDay } from './urgencyTarget.mjs';
import { isTerminalConfirmationStatus, terminalMarkerForStatus, formatAttemptsForSheet, parseAttemptToken, parseTerminalToken } from './contactAttempts.mjs';

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
// "VU5 x1", "D12, C", "C, (Call before Dispatch)", "X3, No WA", "Cancel, (From M)". Under the
// per-type attempt counter model, a cell can also stack up to three attempt codes at once, e.g.
// "VU5 U1,X2" (unreachable once, no_answer twice) -- see lib/contactAttempts.mjs.
//
// Parses column C into urgency/confirmation/attempts/leftover-notes parts. Malformed pieces
// don't throw -- they're reported via `warnings` so the caller can leave the existing app value
// alone for that piece specifically, rather than aborting the whole row or the whole sync.
//
// Up to 4 leading tokens are checked as markers (1 urgency + up to 3 stacked attempt types, or
// 1 urgency + 1 terminal status), and scanning stops at the first token matching none of these.
// This is deliberate: it's what prevents a stray marker-shaped word deep in a free-text note
// (e.g. "No **WA**" meaning "no WhatsApp", not a Wa confirmation) from ever being misread as a
// status change. Everything from the first non-marker token onward -- including real notes like
// "merged with: NN-18268" or "(Call before Dispatch)" -- is preserved verbatim as leftoverText.
//
// A terminal marker (C/Wa/M/Cancelled/Hold) always wins over any attempt codes found in the
// same cell, matching the write-back format where a terminal status replaces attempt codes
// entirely rather than being shown alongside them.
export function parseColumnC(raw, now = new Date()) {
  const trimmed = (raw ?? '').toString().trim();
  const warnings = [];

  if (!trimmed) {
    return { urgencyType: 'normal', urgencyTargetDate: null, urgencyMalformed: false, confirmationStatus: null, attempts: [], leftoverText: null, warnings };
  }

  const rawTokens = trimmed.split(/[,\s]+/).filter(Boolean);
  const stripParens = (t) => t.replace(/^[(]+|[)]+$/g, '');

  let urgencyType = 'normal';
  let urgencyTargetDate = null;
  let urgencyMalformed = false;
  let confirmationStatus = null;
  const attempts = [];
  const seenAttemptTypes = new Set();
  let consumed = 0;

  for (let i = 0; i < Math.min(4, rawTokens.length); i++) {
    const token = stripParens(rawTokens[i]);

    if (urgencyType === 'normal' && !urgencyMalformed) {
      const urgencyMatch = token.match(/^(VU|D)(\d{1,2})$/i);
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
    }

    if (confirmationStatus === null) {
      const terminal = parseTerminalToken(token);
      if (terminal) {
        confirmationStatus = terminal;
        consumed = i + 1;
        continue;
      }
    }

    const attempt = parseAttemptToken(token);
    if (attempt && !seenAttemptTypes.has(attempt.type)) {
      seenAttemptTypes.add(attempt.type);
      if (attempt.overflow) {
        warnings.push(`${token} exceeds the cap for ${attempt.type} -- left unchanged`);
      } else {
        attempts.push({ type: attempt.type, count: attempt.count });
      }
      consumed = i + 1;
      continue;
    }

    // first token that matches nothing recognized -- stop scanning, everything from here is notes
    break;
  }

  const finalAttempts = confirmationStatus ? [] : attempts;
  const leftoverText = rawTokens.slice(consumed).join(' ').trim() || null;

  return { urgencyType, urgencyTargetDate, urgencyMalformed, confirmationStatus, attempts: finalAttempts, leftoverText, warnings };
}

// Inverse of parseColumnC -- reconstructs the full cell string from current app state.
// urgent/hold (the older static urgency types) have no representation in this format, same
// as "normal": only vu/d produce a visible urgency segment. Note this does NOT reconstruct
// leftoverText/notes -- app -> sheet write-back only ever writes the status/attempt markers,
// never touches whatever free-text a moderator already has in that cell beyond them.
export function buildColumnC(urgencyType, urgencyTargetDate, confirmationStatus, attemptRows = []) {
  const urgencyMarker = (urgencyType === 'vu' || urgencyType === 'd') && urgencyTargetDate
    ? `${urgencyType.toUpperCase()}${new Date(urgencyTargetDate).getUTCDate()}`
    : '';
  const statusPart = isTerminalConfirmationStatus(confirmationStatus)
    ? terminalMarkerForStatus(confirmationStatus)
    : formatAttemptsForSheet(attemptRows);
  return [urgencyMarker, statusPart].filter(Boolean).join(' ');
}

// Parses one sheet row (array of cell values, as returned by the Sheets API / Apps Script
// getValues()) into an order-shaped object, or returns { error: reason } if the row should be
// skipped entirely -- reserved for rows with no order id, or missing date/customer/address
// (genuinely no order to build). A missing phone or empty item list still produces a real
// order, just one reconcileSheetRows.ts will mark needs_review, rather than being dropped.
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
  const columnC = c(2); // urgency + confirmation/attempts marker (+ notes) -- see parseColumnC
  const customerName = c(3);
  const phone = cleanPhone(c(4));
  const address = c(5);
  // col6 city, col7 zone code, col8 blank, col9 payment method -- not stored, same as CSV import

  // date/customer name/address are still hard requirements -- without them there's no
  // meaningful order to build at all, just a blank or garbled row. Phone is deliberately NOT
  // included here: a real order missing only a phone number should still become a record (so
  // staff can go fix it), flagged via needs_review rather than silently dropped from the sync.
  if (!createdAt || !customerName || !address) {
    return { error: 'missing required field (date/customer/address)' };
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

  // an order with zero items is still a real record worth keeping (and flagging via
  // needs_review below), not something to drop from the sync -- same reasoning as phone above
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
    // parsed from column C -- confirmationStatus is null when no terminal marker (C/Wa/M/
    // Cancelled/Hold) is present, meaning "don't touch" for an existing order or "use the
    // default" for a new one (see reconcileSheetRows.ts); urgencyMalformed is true if a VU/D-
    // shaped token failed day resolution, in which case reconcileSheetRows.ts falls back to
    // defaults.urgency_type instead of applying it
    parsedUrgencyType: parsedColumnC.urgencyType,
    parsedUrgencyTargetDate: parsedColumnC.urgencyTargetDate,
    urgencyMalformed: parsedColumnC.urgencyMalformed,
    parsedConfirmationStatus: parsedColumnC.confirmationStatus,
    parsedAttempts: parsedColumnC.attempts,
    columnCWarnings: parsedColumnC.warnings,
    // only urgency_type/delivery_status/confirmation_status ever fall back to these -- see above
    defaults: {
      urgency_type: 'normal',
      confirmation_status: 'pending',
      // sheet orders are today's live orders, not the historical/already-fulfilled June
      // import, so "packaging" (not "delivered") is the right just-created default
      delivery_status: returnFlagged ? 'returned' : 'packaging',
    },
  };
}
