// Single source of truth for defaulting confirmation_status at order creation/import time,
// based on order_source and how old the order's original date/time already is when it enters
// the system. Used by: the manual "new order" form, and the CSV bulk import script (and any
// future live Shopify sync) -- so this rule is never duplicated.
//
// Plain JS (not .ts) so it can be imported directly by both the Next.js app and standalone
// Node scripts run outside the Next.js build (this Node version has no TypeScript support).
//
// - social / otc orders: manual/walk-in channels, no confirmation call needed -> confirmed immediately.
// - shopify orders less than 3 days old at the time they enter the system: default to "pending"
//   (needs a confirmation call).
// - shopify orders 3+ days old at the time they enter the system (e.g. a bulk historical import):
//   default to "confirmed_c" instead of pending, since a call this late is no longer useful.
//
// @param {string} orderSource
// @param {Date} orderDate
// @param {Date} [now]
// @returns {string}
export function defaultConfirmationStatus(orderSource, orderDate, now = new Date()) {
  if (orderSource === 'social' || orderSource === 'otc') {
    return 'confirmed_m';
  }
  if (orderSource === 'shopify') {
    const ageDays = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
    return ageDays >= 3 ? 'confirmed_c' : 'pending';
  }
  return 'pending';
}
