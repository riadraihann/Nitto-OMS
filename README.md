# Nitto OMS

A minimal Next.js App Router app connected to Supabase for an order management tool.

## Environment variables

Copy [.env.local.example](.env.local.example) to .env.local and set:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY

## Supabase SQL

Run the SQL from [supabase/orders.sql](supabase/orders.sql) in your Supabase SQL editor.

## Verify the connection

1. Start the dev server with `npm run dev`
2. Visit `http://localhost:3000/api/health`
3. If the table exists and credentials are valid, the response will include `ok: true`
