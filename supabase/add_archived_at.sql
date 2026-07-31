alter table public.orders add column if not exists archived_at timestamp with time zone;

create index if not exists orders_archived_at_idx on public.orders (archived_at);
