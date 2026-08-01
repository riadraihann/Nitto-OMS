-- Speeds up the global search bar (app/components/GlobalSearch.tsx, app/api/search/orders),
-- which runs a `column ILIKE '%term%'` query against order_number, customer_name, phone,
-- address, and special_instructions on every debounced keystroke. A leading wildcard means a
-- plain btree index can't help at all -- Postgres would fall back to a sequential scan across
-- every non-archived order, on every search. pg_trgm's trigram (3-character-fragment) GIN
-- indexes are what actually make '%term%' fast, regardless of where the match falls in the
-- string.
--
-- Tradeoff: each GIN trigram index costs extra storage (roughly on par with the indexed text
-- itself) and a little insert/update overhead to maintain -- five of these is a real but modest
-- cost. Worth it here because these columns are read far more often than written (search runs
-- on every keystroke pause across however many staff are using the tool; orders themselves are
-- written once and edited occasionally), and the table only grows over time since History/
-- Cancelled orders stay in it rather than moving elsewhere.
create extension if not exists pg_trgm;

create index if not exists orders_order_number_trgm_idx on public.orders using gin (order_number gin_trgm_ops);
create index if not exists orders_customer_name_trgm_idx on public.orders using gin (customer_name gin_trgm_ops);
create index if not exists orders_phone_trgm_idx on public.orders using gin (phone gin_trgm_ops);
create index if not exists orders_address_trgm_idx on public.orders using gin (address gin_trgm_ops);
create index if not exists orders_special_instructions_trgm_idx on public.orders using gin (special_instructions gin_trgm_ops);
