-- Adds the "feedback" free-text field (separate from product_suggestions) and turns
-- happiness_score into a strict 1-5 whole-number rating to back the emoji picker on the order
-- detail page (see app/components/HappinessScorePicker.tsx) -- no more freeform decimal scores.
--
-- Checked before writing this: no existing order has a non-null happiness_score (the field has
-- never actually been used in production data), so there's no legacy data to migrate or worry
-- about violating the new constraint.
alter table public.orders add column if not exists feedback text;

alter table public.orders
  alter column happiness_score type smallint using happiness_score::smallint;

alter table public.orders
  drop constraint if exists orders_happiness_score_check;

alter table public.orders
  add constraint orders_happiness_score_check check (happiness_score is null or happiness_score between 1 and 5);

notify pgrst, 'reload schema';
