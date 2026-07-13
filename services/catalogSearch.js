// catalogSearch.js — finds candidate products in Benny's local index.
//
// DESIGN PRINCIPLE (this is the whole point of the rewire):
//
//   This file's job is RECALL, not JUDGMENT.
//
//   It casts a wide net and hands the model a generous set of REAL products.
//   It does NOT decide "this is a mic stand, not a microphone" — that is
//   judgment, and judgment belongs to the model, which actually understands
//   what things are. The old code tried to encode understanding in keyword
//   lists and got it wrong constantly.
//
//   So: we retrieve broadly and let intelligence sort. The only hard rule is
//   that every candidate is a real row from the catalog.

import { getAllProducts, getByHandle } from "./catalog.js";

function norm(s = "") {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const STOP = new Set([
  "the","a","an","and","or","for","with","of","to","in","on","at","is","are",
  "i","we","you","my","our","need","want","looking","some","any","do","does",
  "have","has","can","could","would","please","me","it","that","this","best",
  "good","cheap","new","help","find","show","get","buy","sell","carry","stock"
]);

function tokens(s = "") {
  return norm(s).split(" ").filter(t => t.length >= 2 && !STOP.has(t));
}

// Score how well a product matches the query terms.
// Higher = better. This orders candidates; it does not filter them out.
function scoreProduct(product, queryTokens) {
  if (!queryTokens.length) return 0;

  const title = norm(product.title);
  const vendor = norm(product.vendor);
  const type = norm(product.productType);
  const tagText = norm((product.tags || []).join(" "));
  const collText = norm((product.collections || []).join(" "));
  const desc = norm(product.description || "");

  let score = 0;

  for (const t of queryTokens) {
    // Vendor/brand match is a strong signal.
    if (vendor.includes(t)) score += 30;

    // Product type is the most reliable field in this catalog (98% coverage)
    // and it's how "Microphone" vs "Microphone Stand" is distinguished.
    if (type.includes(t)) score += 25;

    if (title.includes(t)) score += 20;
    if (collText.includes(t)) score += 10;
    if (tagText.includes(t)) score += 8;
    if (desc.includes(t)) score += 3;
  }

  // Exact-ish title match bonus (e.g. a specific model number).
  const joined = queryTokens.join(" ");
  if (joined && title.includes(joined)) score += 40;

  // Prefer sellable products, but never exclude drafts — Benny should know
  // they exist. This is a nudge, not a gate.
  if (product.sellable) score += 5;
  if (product.available) score += 2;

  return score;
}

/**
 * Search the catalog. Returns REAL products only, ranked, never invented.
 *
 * @param {string} query        free text, e.g. "jbl powered speaker"
 * @param {object} opts
 *   limit          max results (default 12)
 *   includeDrafts  include non-sellable products (default true)
 */
export function searchCatalog(query, opts = {}) {
  const { limit = 12, includeDrafts = true } = opts;
  const qTokens = tokens(query);
  if (!qTokens.length) return [];

  const all = getAllProducts();
  const scored = [];

  for (const p of all) {
    if (!includeDrafts && !p.sellable) continue;
    const score = scoreProduct(p, qTokens);
    if (score > 0) scored.push({ product: p, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.product);
}

/** Find products by brand/vendor name. Used for "do you carry X brand?" */
export function findByVendor(vendorQuery, limit = 20) {
  const q = norm(vendorQuery);
  if (!q) return [];
  return getAllProducts()
    .filter(p => norm(p.vendor).includes(q))
    .sort((a, b) => (b.sellable ? 1 : 0) - (a.sellable ? 1 : 0))
    .slice(0, limit);
}

/**
 * The COMPLETE, authoritative list of brands we carry in a category.
 * This is what kills "we only carry Kurzweil pianos" — it's a real count
 * over the whole catalog, not a guess from whatever a text search returned.
 */
export function listVendorsMatching(query, limit = 40) {
  const qTokens = tokens(query);
  const counts = new Map();

  for (const p of getAllProducts()) {
    const hay = norm([p.productType, p.title, (p.collections || []).join(" "), (p.tags || []).join(" ")].join(" "));
    const hit = qTokens.length === 0 || qTokens.some(t => hay.includes(t));
    if (!hit || !p.vendor) continue;

    const key = p.vendor;
    const entry = counts.get(key) || { vendor: key, active: 0, draft: 0 };
    if (p.sellable) entry.active += 1;
    else entry.draft += 1;
    counts.set(key, entry);
  }

  return [...counts.values()]
    .sort((a, b) => (b.active + b.draft) - (a.active + a.draft))
    .slice(0, limit);
}

/** Exact lookup by handle — used when a customer pastes a product link. */
export function findByHandle(handle) {
  return getByHandle(handle) || null;
}

/** Extract product handles from any victorymusical.com links in text. */
export function extractHandlesFromText(text = "") {
  return [
    ...new Set(
      [...String(text).matchAll(/\/products\/([a-z0-9][a-z0-9\-_]*)/gi)].map(m => m[1].toLowerCase())
    )
  ];
}

/**
 * Trim a product to what the model and the product cards need.
 * Draft products carry no price and no cart link — structurally unsellable.
 */
export function slim(product) {
  if (!product) return null;
  return {
    handle: product.handle,
    title: product.title,
    vendor: product.vendor,
    productType: product.productType,
    status: product.status,
    sellable: product.sellable,
    price: product.price,
    priceAmount: product.priceAmount,
    compareAtPriceAmount: product.compareAtPriceAmount,
    currencyCode: product.currencyCode,
    isOnSale: product.isOnSale,
    available: product.available,
    url: product.url,
    image: product.image,
    addToCartUrl: product.addToCartUrl,
    sku: product.sku,

    // VARIANT AWARENESS. Attributes like reed strength, sax finish, or cable
    // length live HERE, never in the product title. Benny must look here before
    // concluding we don't carry a "soft" reed or a "silver" trumpet.
    options: product.options || [],
    variants: (product.variants || []).map(v => ({
      title: v.title,
      sku: v.sku,
      price: v.price,
      available: v.available,
      options: v.options,
      addToCartUrl: v.addToCartUrl
    })),
    hasVariants: !!product.hasVariants
  };
}
