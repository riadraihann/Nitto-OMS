-- Replace the single generic 'confirmed' confirmation_status value with three specific
-- Shopify-confirmation-channel values. Existing rows are backfilled using the same
-- source-based rule as lib/orderDefaults.ts (all pre-existing orders are, by definition,
-- already well past the 3-day mark, so shopify rows map to confirmed_c and social/otc rows
-- map to confirmed_m).

-- step 1: temporarily widen the constraint so both old and new values are valid, allowing
-- the backfill below to run without violating anything.
alter table public.orders drop constraint orders_confirmation_status_check1;

alter table public.orders add constraint orders_confirmation_status_check
  check (confirmation_status in ('pending', 'x1', 'x2', 'x3', 'confirmed', 'confirmed_m', 'confirmed_wa', 'confirmed_c', 'cancelled'));

-- step 2: backfill
update public.orders
set confirmation_status = 'confirmed_m'
where confirmation_status = 'confirmed' and order_source in ('social', 'otc');

update public.orders
set confirmation_status = 'confirmed_c'
where confirmation_status = 'confirmed' and order_source = 'shopify';

-- step 3: tighten the constraint to its final, real set of values
alter table public.orders drop constraint orders_confirmation_status_check;

alter table public.orders add constraint orders_confirmation_status_check
  check (confirmation_status in ('pending', 'x1', 'x2', 'x3', 'confirmed_m', 'confirmed_wa', 'confirmed_c', 'cancelled'));
