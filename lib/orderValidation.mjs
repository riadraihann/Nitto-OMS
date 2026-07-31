// Shared by every path that creates or updates an order (manual creation, moderator edits, sheet
// sync) so a broken-looking record gets flagged instead of silently sitting in the main list.
// Deliberately flags rather than rejects -- see Phase 3 of the data-integrity work: staff should
// be able to go fix the source (sheet/CSV row, or the order itself) rather than the order vanishing.
/** @type {Record<string, string>} */
export const NEEDS_REVIEW_REASON_LABELS = {
  missing_phone: 'Missing phone number',
  no_items: 'No items',
  zero_amount: 'Zero/blank bill amount',
};

// order: needs .phone and .total_amount. items: array of {quantity, unit_price}, or an item
// count is also accepted directly (used where the caller only knows the count, not the list).
export function computeNeedsReview(order, items) {
  const reasons = [];

  if (!order.phone || !String(order.phone).trim()) {
    reasons.push('missing_phone');
  }

  const itemList = Array.isArray(items) ? items : [];
  const itemCount = Array.isArray(items) ? items.length : Number(items ?? 0);
  if (itemCount === 0) {
    reasons.push('no_items');
  }

  const computedSubtotal = itemList.reduce((sum, item) => sum + Number(item.quantity ?? 0) * Number(item.unit_price ?? 0), 0);
  const effectiveAmount = order.total_amount !== null && order.total_amount !== undefined ? Number(order.total_amount) : computedSubtotal;
  if (!effectiveAmount) {
    reasons.push('zero_amount');
  }

  return {
    needs_review: reasons.length > 0,
    needs_review_reasons: reasons.length > 0 ? reasons : null,
  };
}

export function reviewReasonsChanged(a, b) {
  const aList = a ?? [];
  const bList = b ?? [];
  if (aList.length !== bList.length) return true;
  return aList.some((value, index) => value !== bList[index]);
}
