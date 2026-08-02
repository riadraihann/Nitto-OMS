-- Caches the real Shopify numeric order id, resolved lazily (see lib/shopifyAdmin.ts) the first
-- time a moderator cancels a shopify-sourced order and confirms "also cancel on Shopify" --
-- looked up from Shopify's Orders API by order_number (our order_number matches Shopify's order
-- "Name" field, which this store has customized to use an "NN-" prefix instead of "#"). Stored as
-- text, not bigint/numeric: it's only ever used as a URL path segment, never arithmetic, and text
-- sidesteps any large-integer precision concerns entirely.
--
-- Left null for orders that were never resolved (never cancelled through this flow, or resolution
-- failed -- e.g. a manually-typed test order with no real Shopify order behind it at all).
alter table public.orders add column if not exists shopify_order_id text;

notify pgrst, 'reload schema';
