// catalog.js
//
// Benny's own copy of your catalog.
//
// It syncs via the Admin API when Admin credentials are present (this sees EVERY
// product, regardless of sales channel), and falls back to the Storefront API
// when they are not (which only sees products published to the Headless channel).
//
// This means: if the Admin credentials work, you never need to publish products
// to Headless again. If they fail, Benny still works exactly as he does today.

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

/* ------------------------------------------------------------------ */
/* ADMIN API SYNC  (sees everything)                                    */
/* ------------------------------------------------------------------ */

const ADMIN_QUERY = `
  query AdminCatalog($cursor: String) {
    products(first: 250, after: $cursor, query: "status:active") {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          tags
          status
          description
          featuredMedia { preview { image { url } } }
          collections(first: 10) { edges { node { handle } } }
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
          }
          variants(first: 1) {
            edges {
              node {
                id
                sku
                price
                compareAtPrice
                inventoryQuantity
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`;

function mapAdminNode(node) {
  const variant = node.variants?.edges?.[0]?.node || null;
  const priceAmount = toNumber(variant?.price ?? node.priceRangeV2?.minVariantPrice?.amount);
  const compareAtPriceAmount = toNumber(variant?.compareAtPrice);
  const currencyCode = node.priceRangeV2?.minVariantPrice?.currencyCode || "USD";

  const isOnSale =
    compareAtPriceAmount !== null &&
    priceAmount !== null &&
    compareAtPriceAmount > priceAmount;

  return {
    handle: node.handle,
    title: node.title,
    vendor: node.vendor || "",
    productType: node.productType || "",
    tags: node.tags || [],
    description: node.description || "",
    collections: (node.collections?.edges || []).map(e => e.node.handle),
    url: `https://${SHOPIFY_PUBLIC_DOMAIN}/products/${node.handle}`,
    image: node.featuredMedia?.preview?.image?.url || null,
    price: priceAmount !== null ? `${currencyCode} ${priceAmount}` : null,
    priceAmount,
    currencyCode,
    compareAtPrice: compareAtPriceAmount !== null ? `${currencyCode} ${compareAtPriceAmount}` : null,
    compareAtPriceAmount,
    isOnSale,
    available: variant ? variant.availableForSale : null,
    sku: variant?.sku || null,
    addToCartUrl: buildCartUrl(numericId(variant?.id), 1)
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
    if (verbose) console.log(`[admin] page ${page}: ${all.length} products`);
    await sleep(250);
  }

  return all;
}

/* ------------------------------------------------------------------ */
/* STOREFRONT API SYNC  (fallback: only Headless-published products)    */
/* ------------------------------------------------------------------ */

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
          variants(first: 1) {
            edges { node { id sku availableForSale price { amount } compareAtPrice { amount } } }
          }
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
    description: node.description || "",
    collections: (node.collections?.edges || []).map(e => e.node.handle),
    url: node.onlineStoreUrl || `https://${SHOPIFY_PUBLIC_DOMAIN}/products/${node.handle}`,
    image: node.featuredImage?.url || null,
    price: min ? `${min.currencyCode} ${min.amount}` : null,
    priceAmount,
    currencyCode: min?.currencyCode || "USD",
    compareAtPrice: cmp ? `${cmp.currencyCode} ${cmp.amount}` : null,
    compareAtPriceAmount,
    isOnSale:
      compareAtPriceAmount !== null && priceAmount !== null && compareAtPriceAmount > priceAmount,
    available: node.availableForSale,
    sku: variant?.sku || null,
    addToCartUrl: buildCartUrl(numericId(variant?.id), 1)
  };
}

async function syncViaStorefront({ verbose }) {
  const all = [];
  let cursor = null;
  let hasNext = true;
  let page = 0;

  while (hasNext) {
    const data = await storefrontGraphQL(STOREFRONT_QUERY, { cursor });
    const conn = data.products;
    for (const edge of conn.edges) all.push(mapStorefrontNode(edge.node));
    hasNext = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
    page += 1;
    if (verbose) console.log(`[storefront] page ${page}: ${all.length} products`);
    await sleep(250);
  }

  return all;
}

/* ------------------------------------------------------------------ */
/* PUBLIC API                                                           */
/* ------------------------------------------------------------------ */

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
    if (verbose) console.log(`Catalog sync complete via ${source}: ${all.length} products in ${seconds}s`);

    return { ok: true, source, count: all.length, seconds, lastSync, summary: lastSummary };
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
    console.log(`Loaded ${catalog.length} products from disk (${lastSource}, ${lastSync}).`);
    return true;
  } catch (err) {
    console.warn("Could not load saved catalog:", err.message);
    return false;
  }
}

export function summarizeCatalog(list = catalog) {
  const total = list.length;
  const count = p => list.filter(p).length;
  const pct = n => (total ? Math.round((n / total) * 100) : 0);

  const tally = key => {
    const m = new Map();
    for (const p of list) {
      const v = (p[key] || "").trim();
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const collMap = new Map();
  for (const p of list) {
    for (const c of p.collections || []) collMap.set(c, (collMap.get(c) || 0) + 1);
  }

  const withType = count(p => p.productType && p.productType.trim());
  const withImage = count(p => p.image);
  const available = count(p => p.available);

  return {
    total,
    source: lastSource,
    coverage: {
      productType: { count: withType, pct: pct(withType) },
      image: { count: withImage, pct: pct(withImage) },
      available: { count: available, pct: pct(available) }
    },
    vendors: { distinct: tally("vendor").length, top: tally("vendor").slice(0, 30) },
    productTypes: { distinct: tally("productType").length, top: tally("productType").slice(0, 40) },
    collections: {
      distinct: collMap.size,
      top: [...collMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
    }
  };
}

export const getCatalogCount = () => catalog.length;
export const getLastSync = () => lastSync;
export const getLastSource = () => lastSource;
export const getLastSummary = () => lastSummary || summarizeCatalog(catalog);
export const getByHandle = h => byHandle.get(h) || null;
export const getAllProducts = () => catalog;
export { checkAdminAuth };
