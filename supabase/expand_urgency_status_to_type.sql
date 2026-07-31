-- Renames urgency_status -> urgency_type and expands it to support two new dynamic types
-- ("vu" = Very Urgent, "d" = Dispatch), each paired with a real resolved date in the new
-- urgency_target_date column (nullable, only meaningful for vu/d). Existing normal/urgent/hold
-- values are untouched by the rename, so no backfill is needed here.
alter table orders drop constraint orders_urgency_status_check1;
alter table orders rename column urgency_status to urgency_type;
alter table orders add column if not exists urgency_target_date date;
alter table orders add constraint orders_urgency_type_check
  check (urgency_type = any (array['normal', 'urgent', 'hold', 'vu', 'd']));

notify pgrst, 'reload schema';
