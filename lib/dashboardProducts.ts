export type TrackedProduct = { key: string; label: string; base: string };

// Products shown as their own trend chart on the home dashboard, in addition to the overall
// order trend. Add an entry here to track another product -- computeDashboardTrends derives
// every product's daily chart from a single pass over recent order_items, so adding one more
// here costs no extra query. `base` must match the product's base name as grouped by
// lib/productGrouping.mjs (the text before " - ", e.g. "Snuggly Palazzo - Black, XL" -> base
// "Snuggly Palazzo").
export const DASHBOARD_TRACKED_PRODUCTS: TrackedProduct[] = [{ key: 'snuggly-palazzo', label: 'Snuggly Palazzo', base: 'Snuggly Palazzo' }];
