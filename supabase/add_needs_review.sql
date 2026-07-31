alter table public.orders add column if not exists needs_review boolean not null default false;
alter table public.orders add column if not exists needs_review_reasons text[];

create index if not exists orders_needs_review_idx on public.orders (needs_review) where needs_review;
