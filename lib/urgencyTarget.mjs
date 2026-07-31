// Resolves a plain day-of-month (1-31) entered for a "vu"/"d" urgency type into a real
// calendar date, stored under orders.urgency_target_date. Rules (confirmed with the user):
//   - if that day-of-month hasn't happened yet this month (including today itself), use this
//     month; if it's already passed, roll forward to next month
//   - if the resolved month doesn't actually have that day (e.g. "30" resolving to February),
//     reject rather than guess -- no silent rollover-again or clamping
//
// Plain .mjs (not .ts) because this is shared with lib/sheetRowParser.mjs, which itself has to
// stay Node-runnable outside the Next.js build (see that file's usage in scripts/).
// Used identically by the order detail page, the /orders inline editor, the new-order form,
// and now sheet-sync column C parsing -- one place resolves "5" -> a real date everywhere.
function monthName(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
}

export function resolveUrgencyTargetDay(day, now = new Date()) {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return { error: 'Day must be a whole number between 1 and 31' };
  }

  // resolve against the Asia/Dhaka calendar day, consistent with the rest of the app's date handling
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(now)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});

  const todayYear = Number(parts.year);
  const todayMonth = Number(parts.month); // 1-12
  const todayDay = Number(parts.day);

  // today itself counts as "not yet passed" -> stays in the current month
  const useNextMonth = day < todayDay;
  const year = useNextMonth && todayMonth === 12 ? todayYear + 1 : todayYear;
  const month = useNextMonth ? (todayMonth === 12 ? 1 : todayMonth + 1) : todayMonth;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) {
    return { error: `${monthName(year, month)} ${year} only has ${daysInMonth} days -- pick a day that exists in the target month` };
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return { date: `${year}-${mm}-${dd}` };
}

// Applied to any order create/update payload that includes urgency_type. Strips the transient
// urgency_target_day input field and replaces it with the resolved urgency_target_date column
// value -- or, for any non-vu/d type, clears urgency_target_date so it never lingers stale.
export function normalizeUrgencyFields(payload) {
  if (!('urgency_type' in payload)) {
    return { ok: true, payload };
  }

  const { urgency_target_day, ...rest } = payload;
  const urgencyType = rest.urgency_type;

  if (urgencyType === 'vu' || urgencyType === 'd') {
    if (urgency_target_day === undefined || urgency_target_day === null || urgency_target_day === '') {
      return { ok: false, error: `${String(urgencyType).toUpperCase()} requires a day-of-month (1-31)` };
    }
    const dayNum = Number(urgency_target_day);
    if (!Number.isFinite(dayNum)) {
      return { ok: false, error: 'Day-of-month must be a number' };
    }
    const resolved = resolveUrgencyTargetDay(dayNum);
    if ('error' in resolved) {
      return { ok: false, error: resolved.error };
    }
    return { ok: true, payload: { ...rest, urgency_target_date: resolved.date } };
  }

  return { ok: true, payload: { ...rest, urgency_target_date: null } };
}
