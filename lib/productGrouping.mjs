// Shared "base product" grouping: order_items only stores a single product_name string (e.g.
// "Snuggly Palazzo - Black, XL"), with no separate color/size column. Text before the first
// " - " is treated as the base product, everything after as the variant. Used by the
// Products-by-date report and the home dashboard's per-product trend charts, so both group
// products identically -- one place decides what "Snuggly Palazzo" means.
export function splitVariant(productName) {
  const idx = productName.indexOf(' - ');
  if (idx === -1) return { base: productName, variant: '' };
  return { base: productName.slice(0, idx).trim(), variant: productName.slice(idx + 3).trim() };
}

export function baseProductName(productName) {
  return splitVariant(productName).base;
}
