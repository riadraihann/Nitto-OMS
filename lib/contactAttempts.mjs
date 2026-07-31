// Shared domain logic for the per-type contact-attempt counters (replaces the old single
// x1/x2/x3 confirmation_status values). Plain .mjs, not .ts, because lib/sheetRowParser.mjs
// imports from here and has to stay Node-runnable outside the Next.js build.
//
// Three independent counters per order: no_answer (X1/X2/X3, max 3), unreachable
// (Unreachable(1)/Unreachable(2), max 2), phone_off (Phone off(1)/Phone off(2), max 2).
// Logging an attempt replaces that type's own count (1 -> 2 -> 3), never creates a second row
// for the same type. Different types stack in the display, ordered by first_logged_at ascending
// -- re-logging an already-present type bumps its count but never moves its position, since
// first_logged_at is only set once, the first time that type appears for the order.
//
// Setting confirmation_status to a terminal value (confirmed_c/wa/m, cancelled, hold) wipes all
// three counters for the order -- see app/api/orders/route.ts and lib/reconcileSheetRows.ts.

export const ATTEMPT_TYPES = ['no_answer', 'unreachable', 'phone_off'];

export const ATTEMPT_MAX = {
  no_answer: 3,
  unreachable: 2,
  phone_off: 2,
};

/** @type {Record<string, string>} */
export const ATTEMPT_TYPE_LABELS = {
  no_answer: 'No answer',
  unreachable: 'Unreachable',
  phone_off: 'Phone off',
};

// 'hold' here is a confirmation_status value (paused, no more calls needed until a moderator
// resumes it) -- unrelated to urgency_type's own separate 'hold' value in a different column.
export const TERMINAL_CONFIRMATION_STATUSES = ['confirmed_c', 'confirmed_wa', 'confirmed_m', 'cancelled', 'hold'];

export function isTerminalConfirmationStatus(status) {
  return TERMINAL_CONFIRMATION_STATUSES.includes(status);
}

function sortByFirstLogged(rows) {
  return (rows ?? [])
    .filter((row) => row.count > 0)
    .slice()
    .sort((a, b) => new Date(a.first_logged_at).getTime() - new Date(b.first_logged_at).getTime());
}

// UI badge text: "X2", "Unreachable(1)", "Phone off(2)"
export function attemptDisplayCode(type, count) {
  if (type === 'no_answer') return `X${count}`;
  if (type === 'unreachable') return `Unreachable(${count})`;
  if (type === 'phone_off') return `Phone off(${count})`;
  return `${type}(${count})`;
}

export function formatAttemptsForDisplay(rows) {
  return sortByFirstLogged(rows).map((row) => attemptDisplayCode(row.type, row.count)).join(', ');
}

const SHEET_PREFIX = { no_answer: 'X', unreachable: 'U', phone_off: 'P' };

// short sheet notation: "X2", "U1", "P2"
export function attemptSheetCode(type, count) {
  return `${SHEET_PREFIX[type]}${count}`;
}

export function formatAttemptsForSheet(rows) {
  return sortByFirstLogged(rows).map((row) => attemptSheetCode(row.type, row.count)).join(',');
}

// Parses one token (already comma/space-split) as an attempt marker shape: X#, U#, or P#,
// case-insensitive. Returns null if the token isn't shaped like an attempt marker at all (so
// the caller can treat it as ordinary leftover text). If it IS shaped like one but the count
// exceeds that type's cap (e.g. "X4"), returns { overflow: true } instead of null -- the caller
// should still recognize/consume the token (so it doesn't leak into notes) but not apply it,
// per the "leave existing value unchanged, just warn" rule for malformed sheet input.
export function parseAttemptToken(token) {
  const match = /^([XUP])(\d+)$/i.exec(token);
  if (!match) return null;

  const type = match[1].toUpperCase() === 'X' ? 'no_answer' : match[1].toUpperCase() === 'U' ? 'unreachable' : 'phone_off';
  const count = parseInt(match[2], 10);
  if (count < 1) return null;

  if (count > ATTEMPT_MAX[type]) {
    return { type, count, overflow: true };
  }
  return { type, count, overflow: false };
}

const TERMINAL_MARKER_TO_STATUS = {
  c: 'confirmed_c',
  wa: 'confirmed_wa',
  m: 'confirmed_m',
  cancelled: 'cancelled',
  cancel: 'cancelled',
  hold: 'hold',
};

export function parseTerminalToken(token) {
  return TERMINAL_MARKER_TO_STATUS[token.toLowerCase()] ?? null;
}

const STATUS_TO_TERMINAL_MARKER = {
  confirmed_c: 'C',
  confirmed_wa: 'Wa',
  confirmed_m: 'M',
  cancelled: 'Cancelled',
  hold: 'Hold',
};

export function terminalMarkerForStatus(status) {
  return STATUS_TO_TERMINAL_MARKER[status] ?? '';
}
