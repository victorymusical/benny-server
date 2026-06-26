// catalog.js
//
// Benny's own copy of your catalog. Instead of guessing with a live search on
// every question, Benny reads every product on your site once, stores it here,
// and refreshes on a schedule. Lookups then become facts, not guesses.
//
// This module does three things:
//   1. syncCatalog()   - pull every product from Shopify into a local index
//   2. summarizeCatalog() - report the true shape of the catalog (the one-pager)
//   3. simple query helpers Benny will use (by handle, by vendor, all products)
//
// It uses the SAME Storefront token Benny already uses. No new accounts.

import fs from "fs";
import path from "path";

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const SHOPIFY_PUBLIC_DOMAIN = process.env.SHOPIFY_PUBLIC_DOMAIN || SHOPIFY_STORE_DOMAIN;

const DATA_DIR = path.join(process.cwd(), "data");
const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");

// In-memory index. Loaded from disk on boot, refreshed by syncCatalog().
let catalog = [];
let byHandle = new Map();
let lastSync = null;
let lastSummary = null;
let isSyncing = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractNumericId(gid) {
  if (!gid) return null;
  return String(gid).split("/").pop();
}

function buildCartUrl(numericVariantId, quantity = 1) {
  if (!numericVariantId) return null;
  return `https://${SHOPIFY_PUBLIC_DOMAIN}/cart/${numericVariantId}:${quantity}`;
}

async function shopifyGraphQL(query, variables) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    throw new Error("Missing Shopify environment variables.");
  }

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
  if (data.errors) {
    throw new Error("Shopify error: " + JSON.stringify(data.errors).slice(0, 300));
  }
  return data.data;
}

const CATALOG_QUERY = `
  query Catalog($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          handle
          vendor
          productType
          tags
          availableForSale
          onlineStoreUrl
          featuredImage { url }
          priceRange { minVariantPrice { amount currencyCode } }
          compareAtPriceRange { minVariantPrice { amount currencyCode } }
          collections(first: 10) { edges { node { handle title } } }
          variants(first: 1) {
            edges {
              node {
                id
                sku
                availableForSale
                price { amount currencyCode }
                compareAtPrice { amount currencyCode }
              }
            }
          }
        }
      }
    }
  }
`;

function mapNode(node) {
  const minPrice = node.priceRange?.minVariantPrice || null;
  const compareMin = node.compareAtPriceRange?.minVariantPrice || null;
  const priceAmount = toNumber(minPrice?.amount);
  const compareAtPriceAmount = toNumber(compareMin?.amount);

  const variant = node.variants?.edges?.[0]?.node || null;
  const numericVariantId = variant ? extractNumericId(variant.id) : null;

  const collections = (node.collections?.edges || []).map(e => e.node.handle);
  const collectionTitles = (node.collections?.edges || []).map(e => e.node.title);

  const isOnSale =
    compareAtPriceAmount !== null &&
    priceAmount !== null &&
    compareAtPriceAmount > priceAmount;

  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    vendor: node.vendor || "",
    productType: node.productType || "",
    tags: node.tags || [],
    collections,
    collectionTitles,
    url: node.onlineStoreUrl || `https://${SHOPIFY_PUBLIC_DOMAIN}/products/${node.handle}`,
    image: node.featuredImage?.url || null,
    price: minPrice ? `${minPrice.currencyCode} ${minPrice.amount}` : null,
    priceAmount,
    currencyCode: minPrice?.currencyCode || null,
    compareAtPrice: compareMin ? `${compareMin.currencyCode} ${compareMin.amount}` : null,
    compareAtPriceAmount,
    isOnSale,
    available: node.availableForSale,
    sku: variant?.sku || null,
    addToCartUrl: buildCartUrl(numericVariantId, 1)
  };
}

// Pull every product from Shopify into the local index.
export async function syncCatalog({ verbose = true } = {}) {
  if (isSyncing) {
    return { skipped: true, reason: "A sync is already running." };
  }
  isSyncing = true;
  const startedAt = Date.now();

  try {
    const all = [];
    let cursor = null;
    let hasNext = true;
    let page = 0;

    while (hasNext) {
      let data;
      let attempt = 0;
      // Simple retry/backoff for throttling.
      while (true) {
        try {
          data = await shopifyGraphQL(CATALOG_QUERY, { cursor });
          break;
        } catch (err) {
          attempt += 1;
          if (attempt > 4) throw err;
          await sleep(1000 * attempt);
        }
      }

      const conn = data.products;
      for (const edge of conn.edges) all.push(mapNode(edge.node));

      hasNext = conn.pageInfo.hasNextPage;
      cursor = conn.pageInfo.endCursor;
      page += 1;
      if (verbose) console.log(`Catalog sync: page ${page}, ${all.length} products so far`);
      await sleep(250); // be gentle on the API
    }

    // Commit to memory + disk.
    catalog = all;
    byHandle = new Map(all.map(p => [p.handle, p]));
    lastSync = new Date().toISOString();
    lastSummary = summarizeCatalog(all);

    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        CATALOG_PATH,
        JSON.stringify({ lastSync, products: all }, null, 0)
      );
    } catch (err) {
      console.warn("Could not persist catalog to disk:", err.message);
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (verbose) console.log(`Catalog sync complete: ${all.length} products in ${seconds}s`);

    return { ok: true, count: all.length, seconds, lastSync, summary: lastSummary };
  } finally {
    isSyncing = false;
  }
}

// Load the saved index on boot so Benny has the catalog immediately.
export function loadCatalogFromDisk() {
  try {
    if (!fs.existsSync(CATALOG_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
    catalog = raw.products || [];
    byHandle = new Map(catalog.map(p => [p.handle, p]));
    lastSync = raw.lastSync || null;
    lastSummary = summarizeCatalog(catalog);
    console.log(`Loaded ${catalog.length} products from saved catalog (synced ${lastSync}).`);
    return true;
  } catch (err) {
    console.warn("Could not load saved catalog:", err.message);
    return false;
  }
}

// The one-page summary: the true shape of the catalog.
export function summarizeCatalog(list = catalog) {
  const total = list.length;
  const count = pred => list.filter(pred).length;

  const withType = count(p => p.productType && p.productType.trim());
  const withTags = count(p => (p.tags || []).length > 0);
  const withImage = count(p => p.image);
  const withCollections = count(p => (p.collections || []).length > 0);
  const onSale = count(p => p.isOnSale);
  const available = count(p => p.available);

  const tally = key => {
    const map = new Map();
    for (const p of list) {
      const v = (p[key] || "").trim();
      if (!v) continue;
      map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };

  const vendors = tally("vendor");
  const types = tally("productType");

  const collMap = new Map();
  for (const p of list) {
    for (const c of p.collections || []) collMap.set(c, (collMap.get(c) || 0) + 1);
  }
  const collections = [...collMap.entries()].sort((a, b) => b[1] - a[1]);

  // Products with no type AND no collection are the hard-to-place ones.
  const orphans = list.filter(
    p => !(p.productType && p.productType.trim()) && (p.collections || []).length === 0
  );

  const pct = n => (total ? Math.round((n / total) * 100) : 0);

  return {
    total,
    coverage: {
      productType: { count: withType, pct: pct(withType) },
      tags: { count: withTags, pct: pct(withTags) },
      image: { count: withImage, pct: pct(withImage) },
      collections: { count: withCollections, pct: pct(withCollections) },
      available: { count: available, pct: pct(available) },
      onSale: { count: onSale, pct: pct(onSale) }
    },
    vendors: { distinct: vendors.length, top: vendors.slice(0, 25) },
    productTypes: { distinct: types.length, top: types.slice(0, 40) },
    collections: { distinct: collections.length, top: collections.slice(0, 40) },
    orphans: { count: orphans.length, samples: orphans.slice(0, 15).map(p => p.title) }
  };
}

// ---- query helpers Benny will use ----
export function getCatalogCount() {
  return catalog.length;
}
export function getLastSync() {
  return lastSync;
}
export function getLastSummary() {
  return lastSummary || summarizeCatalog(catalog);
}
export function getByHandle(handle) {
  return byHandle.get(String(handle || "").toLowerCase()) || byHandle.get(handle) || null;
}
export function getAllProducts() {
  return catalog;
}
