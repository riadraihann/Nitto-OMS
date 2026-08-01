import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Global search (see app/components/GlobalSearch.tsx) -- looks across ALL non-archived orders
// regardless of which tab (Orders/History/Cancelled) they'd normally show up in. Archived
// orders are deliberately excluded, same as every other normal view; they're only reachable
// from Settings -> Archived.
const RESULT_LIMIT = 8;
const PER_COLUMN_LIMIT = 8;
const SEARCH_COLUMNS = ['order_number', 'customer_name', 'phone', 'address', 'special_instructions'] as const;
const SELECT_COLUMNS = 'id, order_number, customer_name, phone, address, special_instructions, confirmation_status, delivery_status, created_at';

type SearchRow = {
  id: number;
  order_number: string | null;
  customer_name: string;
  phone: string;
  address: string;
  special_instructions: string | null;
  confirmation_status: string;
  delivery_status: string;
  created_at: string;
};

// Postgres LIKE/ILIKE treats % and _ as wildcards -- escape any the user actually typed so a
// literal "%" or "_" in a search term is matched literally rather than as a wildcard.
function escapeIlike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// A short window of plain text around the match, for the snippet shown under an address/
// special-instructions hit -- e.g. searching "leak" against "...ceiling was leaking near the
// stairwell..." shows "...ceiling was leaking near the sta..." instead of the whole address.
function buildSnippet(text: string, term: string): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text.slice(0, 60);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + term.length + 20);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured' }, { status: 500 });
  }
  const client = supabaseAdmin;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();

  // matches the debounced client's own minimum-length gate -- a 1-character query against
  // thousands of orders returns too much to be useful and isn't worth the round trip
  if (q.length < 2) {
    return NextResponse.json({ ok: true, data: [] });
  }

  const pattern = `%${escapeIlike(q)}%`;

  try {
    // One ILIKE query per column run in parallel, rather than a single OR'd query -- avoids
    // hand-rolling PostgREST's .or() filter-string escaping (values containing a comma or
    // parenthesis need special quoting there) in favor of each .ilike() value being passed as
    // a plain, safely-bound parameter. Each is index-accelerated by the pg_trgm indexes (see
    // supabase/add_search_trgm_index.sql) and capped, so the fan-out stays cheap.
    const results = await Promise.all(
      SEARCH_COLUMNS.map((column) =>
        client
          .from('orders')
          .select(SELECT_COLUMNS)
          .is('archived_at', null)
          .ilike(column, pattern)
          .order('created_at', { ascending: false })
          .limit(PER_COLUMN_LIMIT),
      ),
    );

    const firstError = results.find((result) => result.error)?.error;
    if (firstError) {
      return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
    }

    const byId = new Map<number, SearchRow>();
    for (const result of results) {
      for (const row of (result.data ?? []) as unknown as SearchRow[]) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }

    const lowerQ = q.toLowerCase();
    const scored = Array.from(byId.values()).map((row) => {
      // priority order matches the columns list -- order_number/customer_name/phone are shown
      // directly in every result row regardless, so they don't need their own callout; address
      // and special_instructions do, via a snippet, since those fields aren't otherwise shown
      let matchField: (typeof SEARCH_COLUMNS)[number] | null = null;
      let snippet: string | null = null;

      if (row.order_number && row.order_number.toLowerCase().includes(lowerQ)) {
        matchField = 'order_number';
      } else if (row.customer_name?.toLowerCase().includes(lowerQ)) {
        matchField = 'customer_name';
      } else if (row.phone?.toLowerCase().includes(lowerQ)) {
        matchField = 'phone';
      } else if (row.address?.toLowerCase().includes(lowerQ)) {
        matchField = 'address';
        snippet = buildSnippet(row.address, q);
      } else if (row.special_instructions?.toLowerCase().includes(lowerQ)) {
        matchField = 'special_instructions';
        snippet = buildSnippet(row.special_instructions, q);
      }

      const tier = matchField === 'address' || matchField === 'special_instructions' ? 1 : 0;
      return { row, matchField, snippet, tier };
    });

    scored.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime();
    });

    const data = scored.slice(0, RESULT_LIMIT).map(({ row, matchField, snippet }) => ({
      id: row.id,
      order_number: row.order_number,
      customer_name: row.customer_name,
      phone: row.phone,
      confirmation_status: row.confirmation_status,
      delivery_status: row.delivery_status,
      match_field: matchField,
      snippet,
    }));

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
