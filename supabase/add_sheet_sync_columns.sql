-- Tracks orders synced in from the "Real Todays" Google Sheet (one-way, sheet -> app).
-- synced_from_sheet_at: set (and refreshed) whenever the sheet sync creates/updates this order.
--   Only orders with this set are eligible for the removed_from_sheet_at logic below --
--   CSV-imported and manually-entered orders must never be touched by the sheet sync.
-- removed_from_sheet_at: set when a previously-synced order's ID is no longer present in the
--   sheet's latest full contents. Cleared automatically if the order reappears in a later sync.
alter table orders
  add column if not exists synced_from_sheet_at timestamptz,
  add column if not exists removed_from_sheet_at timestamptz;

create index if not exists orders_synced_from_sheet_at_idx on orders (synced_from_sheet_at)
  where synced_from_sheet_at is not null;

notify pgrst, 'reload schema';
