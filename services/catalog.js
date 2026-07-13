// catalog.js — Benny's own copy of the Victory catalog.
//
// KEY CHANGE IN THIS VERSION:
// We now sync BOTH active and draft products, tagged distinctly.
//
//   ACTIVE  -> Benny can recommend it: price, stock, Add to Cart button.
//   DRAFT   -> Benny KNOWS it exists but can NEVER sell it. No price, no cart.
//              Correct answer is "we can likely source that, let's connect you
//              with the team."
//
// Syncs via the Admin API (sees everything). Falls back to the Storefront API
// if Admin credentials are missing, so it can never leave Benny worse off.

import fs from "fs";
import path from "path";
import { adminGraphQL, hasAdminCredentials, checkAdminAuth } from "./shopifyAuth.js";

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const SHOPIFY_PUBLIC_DOMAIN = process.env.SHOPIFY_PUBLIC_DOMAIN || SHOPIFY_STORE_DOMAIN;

const DATA_DIR = path.join(process.cwd(), "data");
const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");

let catalog = [];
let byHandle = new Map();
let lastSync = null;
let lastSummary = null;
let lastSource = null;
let isSyncing = false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const toNumber = v => (Number.isFinite(Number(v)) ? Number(v) : null);
const numericId = gid => (gid ? String(gid).split("/").pop() : null);

function buildCartUrl(variantId, qty = 1) {
  if (!variantId) return null;
  return `https://${SHOPIFY_PUBLIC_DOMAIN}/cart/${variantId}:${qty}`;
}

/* ---------------- ADMIN API (sees active + draft) ---------------- */

const ADMIN_QUERY = `
  query AdminCatalog($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active OR status:draft") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          title handle vendor productType tags status description
          featuredMedia { preview { image { url } } }
          collections(first: 10) { edges { node { handle } } }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          variants(first: 1) {
            edges { node { id sku price compareAtPrice availableForSale } }
          }
        }
      }
    }
  }
`;

function mapAdminNode(node) {
  const variant = node.variants?.edges?.[0]?.node || null;
  const isDraft = String(node.status).toUpperCase() === "DRAFT";

  const priceAmount = toNumber(variant?.price ?? node.priceRangeV2?.minVariantPrice?.amount);
  const compareAtPriceAmount = toNumber(variant?.compareAtPrice);
  const currencyCode = node.priceRangeV2?.minVariantPrice?.currencyCode || "USD";

  const isOnSale =
    !isDraft &&
    compareAtPriceAmount !== null &&
    priceAmount !== null &&
    compareAtPriceAmount > priceAmount;

  return {
    handle: node.handle,
    title: node.title,
    vendor: node.vendor || "",
    productType: node.productType || "",
    tags: node.tags || [],
    description: (node.description || "").slice(0, 400),
    collections: (node.collections?.edges || []).map(e => e.node.handle),

    // THE CRITICAL FIELD. Everything downstream keys off this.
    status: isDraft ? "draft" : "active",
    sellable: !isDraft,

    // Draft products carry NO price and NO cart link. Structurally impossible
    // for Benny to quote a price on something we can't sell today.
    url: isDraft ? null : `https://${SHOPIFY_PUBLIC_DOMAIN}/products/${node.handle}`,
    image: node.featuredMedia?.preview?.image?.url || null,
    price: isDraft ? null : (priceAmount !== null ? `${currencyCode} ${priceAmount}` : null),
    priceAmount: isDraft ? null : priceAmount,
    currencyCode: isDraft ? null : currencyCode,
    compareAtPrice: isDraft || compareAtPriceAmount === null ? null : `${currencyCode} ${compareAtPriceAmount}`,
    compareAtPriceAmount: isDraft ? null : compareAtPriceAmount,
    isOnSale,
    available: isDraft ? null : (variant ? variant.availableForSale : null),
    sku: variant?.sku || null,
    addToCartUrl: isDraft ? null : buildCartUrl(numericId(variant?.id), 1)
  };
}

async function syncViaAdmin({ verbose }) {
  const all = [];
  let cursor = null;
  let hasNext = true;
  let page = 0;

  while (hasNext) {
    let data;
    let attempt = 0;
    while (true) {
      try {
        data = await adminGraphQL(ADMIN_QUERY, { cursor });
        break;
      } catch (err) {
        attempt += 1;
        if (attempt > 4) throw err;
        await sleep(1000 * attempt);
      }
    }

    const conn = data.products;
    for (const edge of conn.edges) all.push(mapAdminNode(edge.node));

    hasNext = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
    page += 1;
    if (verbose && page % 5 === 0) console.log(`[admin] page ${page}: ${all.length} products`);
    await sleep(200);
  }

  return all;
}

/* ---------------- STOREFRONT FALLBACK (active only) ---------------- */

const STOREFRONT_QUERY = `
  query Catalog($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          title handle vendor productType tags description availableForSale onlineStoreUrl
          featuredImage { url }
          priceRange { minVariantPrice { amount currencyCode } }
          compareAtPriceRange { minVariantPrice { amount currencyCode } }
          collections(first: 10) { edges { node { handle } } }
          variants(first: 1) { edges { node { id sku price { amount } compareAtPrice { amount } } } }
        }
      }
    }
  }
`;

async function storefrontGraphQL(query, variables) {
  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/api/2025-10/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_ACCESS_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await response.json();
  if (data.errors) throw new Error("Storefront error: " + JSON.stringify(data.errors).slice(0, 200));
  return data.data;
}

function mapStorefrontNode(node) {
  const variant = node.variants?.edges?.[0]?.node || null;
  const min = node.priceRange?.minVariantPrice;
  const cmp = node.compareAtPriceRange?.minVariantPrice;
  const priceAmount = toNumber(min?.amount);
  const compareAtPriceAmount = toNumber(cmp?.amount);

  return {
    handle: node.handle,
    title: node.title,
    vendor: node.vendor || "",
    productType: node.productType || "",
    tags: node.tags || [],
    description: (node.description || "").slice(0, 400),
    collections: (node.collections?.edges || []).map(e => e.node.handle),
    status: "active",
    sellable: true,
    url: node.onlineStoreUrl || `https://${SHOPIFY_PUBLIC_DOMAIN}/products/${node.handle}`,
    image: node.featuredImage?.url || null,
    price: min ? `${min.currencyCode} ${min.amount}` : null,
    priceAmount,
    currencyCode: min?.currencyCode || "USD",
    compareAtPrice: cmp ? `${cmp.currencyCode} ${cmp.amount}` : null,
    compareAtPriceAmount,
    isOnSale: compareAtPriceAmount !== null && priceAmount !== null && compareAtPriceAmount > priceAmount,
    available: node.availableForSale,
    sku: variant?.sku || null,
    addToCartUrl: buildCartUrl(numericId(variant?.id), 1)
  };
}

async function syncViaStorefront({ verbose }) {
  const all = [];
  let cursor = null;
  let hasNext = true;
  while (hasNext) {
    const data = await storefrontGraphQL(STOREFRONT_QUERY, { cursor });
    const conn = data.products;
    for (const edge of conn.edges) all.push(mapStorefrontNode(edge.node));
    hasNext = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
    await sleep(200);
  }
  return all;
}

/* ---------------- PUBLIC API ---------------- */

export async function syncCatalog({ verbose = true } = {}) {
  if (isSyncing) return { skipped: true, reason: "Sync already running." };
  isSyncing = true;
  const started = Date.now();

  try {
    let all;
    let source;

    if (hasAdminCredentials()) {
      try {
        all = await syncViaAdmin({ verbose });
        source = "admin_api";
      } catch (err) {
        console.warn("Admin sync failed, falling back to Storefront:", err.message);
        all = await syncViaStorefront({ verbose });
        source = "storefront_api_fallback";
      }
    } else {
      all = await syncViaStorefront({ verbose });
      source = "storefront_api";
    }

    catalog = all;
    byHandle = new Map(all.map(p => [p.handle, p]));
    lastSync = new Date().toISOString();
    lastSource = source;
    lastSummary = summarizeCatalog(all);

    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CATALOG_PATH, JSON.stringify({ lastSync, source, products: all }));
    } catch (err) {
      console.warn("Could not persist catalog:", err.message);
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const activeCount = all.filter(p => p.sellable).length;
    const draftCount = all.length - activeCount;
    if (verbose) {
      console.log(`Sync complete via ${source}: ${all.length} products (${activeCount} active, ${draftCount} draft) in ${seconds}s`);
    }

    return {
      ok: true,
      source,
      count: all.length,
      active: activeCount,
      draft: draftCount,
      seconds,
      lastSync,
      summary: lastSummary
    };
  } finally {
    isSyncing = false;
  }
}

export function loadCatalogFromDisk() {
  try {
    if (!fs.existsSync(CATALOG_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
    catalog = raw.products || [];
    byHandle = new Map(catalog.map(p => [p.handle, p]));
    lastSync = raw.lastSync || null;
    lastSource = raw.source || null;
    lastSummary = summarizeCatalog(catalog);
    console.log(`Loaded ${catalog.length} products from disk (${lastSource}).`);
    return true;
  } catch (err) {
    console.warn("Could not load saved catalog:", err.message);
    return false;
  }
}

export function summarizeCatalog(list = catalog) {
  const total = list.length;
  const active = list.filter(p => p.sellable);
  const draft = list.filter(p => !p.sellable);
  const pct = n => (total ? Math.round((n / total) * 100) : 0);

  const tally = (arr, key) => {
    const m = new Map();
    for (const p of arr) {
      const v = (p[key] || "").trim();
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const withType = list.filter(p => p.productType && p.productType.trim()).length;
  const withImage = list.filter(p => p.image).length;

  return {
    total,
    active: active.length,
    draft: draft.length,
    source: lastSource,
    coverage: {
      productType: { count: withType, pct: pct(withType) },
      image: { count: withImage, pct: pct(withImage) }
    },
    vendors: { distinct: tally(list, "vendor").length, top: tally(list, "vendor").slice(0, 30) },
    productTypes: { distinct: tally(list, "productType").length, top: tally(list, "productType").slice(0, 40) }
  };
}

export const getCatalogCount = () => catalog.length;
export const getActiveCount = () => catalog.filter(p => p.sellable).length;
export const getDraftCount = () => catalog.filter(p => !p.sellable).length;
export const getLastSync = () => lastSync;
export const getLastSource = () => lastSource;
export const getLastSummary = () => lastSummary || summarizeCatalog(catalog);
export const getByHandle = h => byHandle.get(h) || null;
export const getAllProducts = () => catalog;
export { checkAdminAuth };
