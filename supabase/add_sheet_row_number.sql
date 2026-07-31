-- Tracks which row of the "Real Todays Orders" sheet an order was last synced from, so
-- app -> sheet write-back (column C) can target the cell directly instead of re-scanning the
-- whole tab for a matching order_number on every write. Refreshed on every sheet-sync pass,
-- so it self-heals if rows shift (insert/delete above it) between syncs.
alter table orders add column if not exists sheet_row_number integer;

notify pgrst, 'reload schema';
