export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined> | undefined;

function getParam(searchParams: SearchParams, key: string): string {
  const value = searchParams?.[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

// Reads page/page_size off searchParams with safe defaults -- an invalid or missing page_size
// falls back to DEFAULT_PAGE_SIZE rather than an arbitrary user-supplied number, so a page_size
// query param can't be used to force-fetch an unbounded number of rows.
export function parsePageParams(searchParams: SearchParams): { page: number; pageSize: number } {
  const pageRaw = Number(getParam(searchParams, 'page'));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const sizeRaw = Number(getParam(searchParams, 'page_size'));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(sizeRaw) ? sizeRaw : DEFAULT_PAGE_SIZE;

  return { page, pageSize };
}

// Supabase/PostgREST .range() is an inclusive [from, to] pair of row offsets.
export function rangeFor(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return [from, to];
}

// Builds a same-page href that preserves every current query param except the ones in
// `overrides` -- used for pagination links (change only `page`) and the page-size selector
// (change `page_size` and reset `page` back to 1). Keeps filter state intact across navigation.
export function buildQueryHref(basePath: string, current: Record<string, string>, overrides: Record<string, string | number | undefined>): string {
  const merged: Record<string, string> = { ...current };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === '') {
      delete merged[key];
    } else {
      merged[key] = String(value);
    }
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }

  const qs = params.toString();
  return `${basePath}${qs ? `?${qs}` : ''}`;
}
