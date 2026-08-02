// Single source of truth for "what day/time is it in Bangladesh" (Asia/Dhaka, GMT+6, no DST).
// Every "today" boundary calculation (dashboard stats, confirmation rate, date-based filtering)
// and every displayed timestamp in the app must go through this, not bare `new Date()` or
// whatever timezone the server/browser happens to be running in. Plain .mjs (not .ts) so it
// stays importable from standalone `node scripts/*.mjs` runs as well as the Next.js app, same as
// lib/contactAttempts.mjs and lib/orderDefaults.mjs.
//
// Pinning display formatting here too (not just query boundaries) matters beyond cosmetics:
// several timestamp displays run through a "use client" component that Next also renders on the
// server during SSR. If formatting used the runtime's local timezone, a server running in UTC
// (e.g. Vercel) would render different text server-side than the browser produces on hydration
// (whatever the viewer's local timezone is) -- a hydration mismatch, not just a wrong-looking
// clock. Pinning to Asia/Dhaka everywhere makes server and client render identical text.

export const DHAKA_TZ = 'Asia/Dhaka';
export const DHAKA_OFFSET = '+06:00';

// Splits a Date (or ISO string) into its Asia/Dhaka calendar-day parts -- e.g. a moment that's
// already past midnight in Dhaka but not yet in UTC resolves to the Dhaka day, not the UTC one.
/** @param {Date | string} [input] */
export function dhakaDateParts(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DHAKA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// 'YYYY-MM-DD' for the Asia/Dhaka calendar day containing `input`.
/** @param {Date | string} [input] */
export function dhakaDayString(input = new Date()) {
  const { year, month, day } = dhakaDateParts(input);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// [startIso, endIsoExclusive) for the given 'YYYY-MM-DD' Dhaka calendar day, expressed as
// offset-tagged ISO strings -- safe to pass straight into Supabase .gte/.lt on any timestamptz
// column, since Postgres compares instants, not wall-clock text.
export function dhakaDayBounds(dayStr) {
  const startIso = `${dayStr}T00:00:00.000${DHAKA_OFFSET}`;
  const [y, m, d] = dayStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDayStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  const endIso = `${nextDayStr}T00:00:00.000${DHAKA_OFFSET}`;
  return { startIso, endIso };
}

// Bounds for "today" in Asia/Dhaka, as of `now` (defaults to the real current instant).
/** @param {Date | string} [now] */
export function todayDhakaBounds(now = new Date()) {
  return dhakaDayBounds(dhakaDayString(now));
}

// Returns the last `count` Dhaka calendar days as 'YYYY-MM-DD' strings, oldest first, including
// today. Used for trend charts (Phase 4) so each bucket lines up with a real Dhaka calendar day.
/** @param {number} count @param {Date | string} [now] */
export function recentDhakaDays(count, now = new Date()) {
  const { year, month, day } = dhakaDateParts(now);
  const todayUtcMidnight = Date.UTC(year, month - 1, day);
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(todayUtcMidnight - i * 86400000);
    days.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return days;
}

// Display formatting -- always Asia/Dhaka regardless of server or viewer locale/timezone.
/** @param {string | null | undefined} iso */
export function formatDhakaDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DHAKA_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/** @param {string | null | undefined} iso */
export function formatDhakaDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DHAKA_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

// Long form for section/group headers (e.g. History grouped by dispatch date) --
// "Monday, August 3, 2026" -- distinct from formatDhakaDate's compact numeric form used inline.
/** @param {string | null | undefined} iso */
export function formatDhakaDateLong(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DHAKA_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
