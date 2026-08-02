-- Dispatch date for History's date-grouped view (app/history/page.tsx), replacing created_at
-- (order-placed date) with the actual ship date.
--
-- courier_handoff_date: set automatically the first time delivery_status transitions to
--   'sent_to_courier' (see app/api/orders/route.ts's PATCH handler). This is the real "dispatch"
--   moment going forward.
-- delivered_date: set automatically the first time delivery_status transitions to 'delivered'.
--   Used as the dispatch date only as a fallback, for orders that have no tracked
--   courier_handoff_date -- which today means every order from the June CSV import: those were
--   bulk-inserted already in a 'delivered' state, with no separate "sent to courier" step ever
--   recorded in this system, and are backfilled (see scripts/backfill-dispatch-dates.mjs) from
--   the original CSV's date-header-row batches, not guessed from created_at.
--
-- dispatch_date: generated, coalesce(courier_handoff_date, delivered_date) -- courier_handoff_date
-- wins when both are set (an order dispatched and later confirmed delivered still has "dispatched"
-- as its meaningful date), delivered_date is purely the historical-import fallback. Left null only
-- for orders with neither timestamp at all (e.g. a handful of live orders that reached 'delivered'
-- before this column existed, with no history log of the transition either) -- History groups
-- those into a separate "Unknown dispatch date" section rather than guessing.
alter table public.orders
  add column if not exists courier_handoff_date timestamptz,
  add column if not exists delivered_date timestamptz;

alter table public.orders
  add column if not exists dispatch_date timestamptz generated always as (coalesce(courier_handoff_date, delivered_date)) stored;

create index if not exists orders_dispatch_date_idx on public.orders (dispatch_date desc);

notify pgrst, 'reload schema';
