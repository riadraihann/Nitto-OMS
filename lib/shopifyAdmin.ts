import { logOrderHistory } from '@/lib/orderHistory.mjs';

// Thin wrapper around Shopify's REST Admin API, used only for cancelling a shopify-sourced
// order on Shopify itself when a moderator cancels it here (see app/api/orders/route.ts's PATCH
// handler). Nothing else in this app talks to Shopify directly -- orders themselves still flow in
// one-way through the Google Sheet sync (lib/reconcileSheetRows.ts).

const env = process.env as unknown as Record<string, string | undefined>;
const SHOPIFY_STORE_DOMAIN = env.SHOPIFY_STORE_DOMAIN?.trim();
const SHOPIFY_ADMIN_API_TOKEN = env.SHOPIFY_ADMIN_API_TOKEN?.trim();
const SHOPIFY_API_VERSION = env.SHOPIFY_API_VERSION?.trim() || '2024-10';

function isConfigured(): boolean {
  return Boolean(SHOPIFY_STORE_DOMAIN && SHOPIFY_ADMIN_API_TOKEN);
}

async function shopifyFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN as string,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

// Our order_number (e.g. "NN-18348") matches Shopify's own order "Name" field for this store
// (checkout settings customize the order-number prefix to "NN-" instead of "#") -- confirmed with
// the store owner, not guessed. status=any is required: a since-cancelled or archived order
// wouldn't show up under Shopify's default open-orders-only filter.
async function findShopifyOrderIdByName(orderName: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await shopifyFetch(`/orders.json?name=${encodeURIComponent(orderName)}&status=any&fields=id,name`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Shopify order lookup failed (${res.status}): ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { orders?: Array<{ id: number | string }> };
    const order = data.orders?.[0];
    if (!order) {
      return { ok: false, error: `No Shopify order found with name "${orderName}" -- it may never have been a real Shopify order (e.g. manually typed in), or the name doesn't match` };
    }
    return { ok: true, id: String(order.id) };
  } catch (error) {
    return { ok: false, error: `Couldn't reach Shopify: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
}

async function cancelShopifyOrderById(shopifyOrderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Conservative defaults: a generic reason (Shopify requires one), and no customer-facing
    // cancellation email -- a moderator cancelling here shouldn't silently trigger customer
    // notifications on Shopify's side. Restock behavior is left at Shopify's own default.
    const res = await shopifyFetch(`/orders/${shopifyOrderId}/cancel.json`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'other', email: false }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Shopify cancel failed (${res.status}): ${text.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Couldn't reach Shopify: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
}

type OrderForCancel = {
  id: number;
  order_number: string | null;
  order_source: string;
  shopify_order_id: string | null;
};

// Called right after an order has already been cancelled app-side (see app/api/orders/route.ts) --
// resolves+caches the Shopify order id if not already known, then cancels it on Shopify.
// Always returns a result rather than throwing: a Shopify-side failure must never be treated as
// the app-side cancellation failing, it's already committed by the time this runs.
export async function cancelOnShopify(
  supabase: any,
  order: OrderForCancel,
  actorName: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await attemptShopifyCancel(supabase, order);
  await logOrderHistory(
    supabase,
    order.id,
    [{ field: 'shopify_cancel', old_value: null, new_value: result.ok ? `cancelled on Shopify (order ${result.shopifyOrderId})` : `failed: ${result.error}` }],
    'moderator',
    actorName,
  );
  return result;
}

async function attemptShopifyCancel(
  supabase: any,
  order: OrderForCancel,
): Promise<{ ok: true; shopifyOrderId: string } | { ok: false; error: string }> {
  if (!isConfigured()) {
    return { ok: false, error: 'Shopify integration is not configured (missing SHOPIFY_STORE_DOMAIN/SHOPIFY_ADMIN_API_TOKEN)' };
  }

  let shopifyOrderId = order.shopify_order_id;

  if (!shopifyOrderId) {
    if (!order.order_number) {
      return { ok: false, error: 'This order has no order_number to look up on Shopify' };
    }
    const lookup = await findShopifyOrderIdByName(order.order_number);
    if (!lookup.ok) {
      return { ok: false, error: lookup.error };
    }
    shopifyOrderId = lookup.id;
    await supabase.from('orders').update({ shopify_order_id: shopifyOrderId }).eq('id', order.id);
  }

  const result = await cancelShopifyOrderById(shopifyOrderId);
  return result.ok ? { ok: true, shopifyOrderId } : result;
}
