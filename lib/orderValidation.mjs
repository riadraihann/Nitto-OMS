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

// The feedback text field (see the order detail page's Feedback box) is capped at this many
// words -- enforced both client-side (live counter, disables Save) and here server-side, since
// the PATCH/POST endpoints are the real boundary a direct API call would still have to pass.
export const FEEDBACK_MAX_WORDS = 500;

export function countWords(text) {
  if (!text) return 0;
  const trimmed = String(text).trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

// Shared by the order create (POST) and update (PATCH) endpoints -- validates the two
// feedback-related fields whenever they're present in the payload being written. happiness_score
// also has a DB check constraint (1-5, see supabase/add_feedback_and_happiness_constraint.sql),
// but that surfaces as a generic Postgres constraint-violation message; checking here first
// gives a clean 400 with a specific reason instead.
export function validateFeedbackFields(payload) {
  if (payload && 'happiness_score' in payload && payload.happiness_score !== null && payload.happiness_score !== undefined) {
    const score = Number(payload.happiness_score);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return { ok: false, error: 'Happiness score must be a whole number from 1 to 5' };
    }
  }

  if (payload && 'feedback' in payload && payload.feedback) {
    const count = countWords(payload.feedback);
    if (count > FEEDBACK_MAX_WORDS) {
      return { ok: false, error: `Feedback must be ${FEEDBACK_MAX_WORDS} words or fewer (currently ${count})` };
    }
  }

  return { ok: true };
}
