// Shared by everything that mutates the orders table (moderator edits via the API routes,
// the Google Sheet sync reconciler, and any future import script) so every write path logs
// through the same shape into order_history. Plain .mjs, not .ts, so it stays importable from
// raw `node script.mjs` import scripts as well as from the Next.js app.

const STRINGABLE = (value) => (value === null || value === undefined ? null : String(value));

// Compares only the given fields between two order-shaped objects and returns one
// {field, old_value, new_value} entry per field that actually changed. Values are stringified
// for storage since old/new can be a mix of text, number, or null across different fields.
export function diffOrderFields(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    const oldValue = STRINGABLE(before?.[field]);
    const newValue = STRINGABLE(after?.[field]);
    if (oldValue !== newValue) {
      changes.push({ field, old_value: oldValue, new_value: newValue });
    }
  }
  return changes;
}

// Summarizes a line-item list into a single comparable string (sku x qty @ price, sorted) so
// an order_items change can be logged as one 'order_items' history row rather than one row
// per item field -- item-level diffing isn't useful here since sheet syncs and imports replace
// the whole item set at once, not one field at a time.
export function summarizeItems(items) {
  return (items ?? [])
    .map((item) => `${item.sku || item.product_name} x${item.quantity} @${item.unit_price}`)
    .sort()
    .join(', ');
}

// Never throws -- a logging failure must not take down the order write it's describing. Callers
// that care can inspect the returned {ok, error}, but the standard usage is fire-and-forget
// alongside the real mutation.
/** @param {string | null} [actor] */
export async function logOrderHistory(supabaseClient, orderId, changes, source, actor = null) {
  if (!changes || changes.length === 0) return { ok: true };

  const rows = changes.map((change) => ({
    order_id: orderId,
    field: change.field,
    old_value: change.old_value,
    new_value: change.new_value,
    source,
    actor,
  }));

  try {
    const { error } = await supabaseClient.from('order_history').insert(rows);
    if (error) {
      console.error('order_history insert failed', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('order_history insert threw', message);
    return { ok: false, error: message };
  }
}
