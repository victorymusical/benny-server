// catalog.js
//
// Benny's own copy of your catalog.
//
// IMPORTANT CHANGE:
// - If SHOPIFY_ADMIN_ACCESS_TOKEN is set, syncCatalog() now uses the Shopify Admin
//   GraphQL API as the source of truth. This sees the real Shopify catalog better
//   than the Storefront API, which can miss products not exposed to that channel.
// - If SHOPIFY_ADMIN_ACCESS_TOKEN is not set, it falls back to the Storefront API
//   so the app does not break while you are setting up the Admin token.

import fs from "fs";
import path from "path";

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;

// Use the myshopify.com domain here when possible, for example:
// victory-musical.myshopify.com
const SHOPIFY_ADMIN_STORE_DOMAIN =
  process.env.SHOPIFY_ADMIN_STORE_DOMAIN || SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04";

// Customer-facing domain for product links and add-to-cart links.
const SHOPIFY_PUBLIC_DOMAIN = process.env.SHOPIFY_PUBLIC_DOMAIN || SHOPIFY_STORE_DOMAIN;
const SHOPIFY_CURRENCY_CODE = process.env.SHOPIFY_CURRENCY_CODE || "USD";

const DATA_DIR = path.join(process.cwd(), "data");
const CATALOG_PATH = path.join(DATA_DIR, "catalog.json");

// In-memory index. Loaded from disk on boot, refreshed by syncCatalog().
let catalog = [];
let byHandle = new Map();
let lastSync = null;
let lastSummary = null;
let isSyncing = false;
let lastSyncSource = null;

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

function cleanDomain(domain) {
  return String(domain || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim();
}

function buildCartUrl(numericVariantId, quantity = 1) {
  if (!numericVariantId) return null;
  return `https://${cleanDomain(SHOPIFY_PUBLIC_DOMAIN)}/cart/${numericVariantId}:${quantity}`;
}

function formatMoneyFromV2(money) {
  if (!money) return null;
  return `${money.currencyCode || SHOPIFY_CURRENCY_CODE} ${money.amount}`;
}

function formatMoneyScalar(value, currencyCode = SHOPIFY_CURRENCY_CODE) {
  if (value === null || value === undefined || value === "") return null;
  return `${currencyCode} ${value}`;
}

async function shopifyStorefrontGraphQL(query, variables) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    throw new Error("Missing Shopify Storefront environment variables.");
  }

  const endpoint = `https://${cleanDomain(SHOPIFY_STORE_DOMAIN)}/api/2025-10/graphql.json`;
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
    throw new Error("Shopify Storefront error: " + JSON.stringify(data.errors).slice(0, 500));
  }
  return data.data;
}

async function shopifyAdminGraphQL(query, variables) {
  if (!SHOPIFY_ADMIN_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error("Missing SHOPIFY_ADMIN_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN.");
  }

  const endpoint = `https://${cleanDomain(SHOPIFY_ADMIN_STORE_DOMAIN)}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json();
  if (data.errors) {
    throw new Error("Shopify Admin error: " + JSON.stringify(data.errors).slice(0, 800));
  }
  return data.data;
}

const STOREFRONT_CATALOG_QUERY = `
  query StorefrontCatalog($cursor: String) {
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
          description
          availableForSale
          onlineStoreUrl
          featuredImage { url altText }
          priceRange { minVariantPrice { amount currencyCode } }
          compareAtPriceRange { minVariantPrice { amount currencyCode } }
          collections(first: 50) { edges { node { handle title } } }
          options { name values }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                availableForSale
                selectedOptions { name value }
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

const ADMIN_CATALOG_QUERY = `
  query AdminCatalog($cursor: String, $productQuery: String!) {
    products(first: 250, after: $cursor, query: $productQuery) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          legacyResourceId
          title
          handle
          vendor
          productType
          tags
          description
          status
          totalInventory
          tracksInventory
          onlineStoreUrl
          featuredMedia {
            ... on MediaImage {
              image { url altText }
            }
          }
          priceRangeV2 {
            minVariantPrice { amount currencyCode }
          }
          compareAtPriceRange {
            minVariantCompareAtPrice { amount currencyCode }
          }
          collections(first: 50) { edges { node { handle title } } }
          options { name values }
          variants(first: 250) {
            edges {
              node {
                id
                legacyResourceId
                title
                sku
                availableForSale
                inventoryQuantity
                sellableOnlineQuantity
                selectedOptions { name value }
                price
                compareAtPrice
              }
            }
          }
        }
      }
    }
  }
`;

function mapStorefrontNode(node) {
  const minPrice = node.priceRange?.minVariantPrice || null;
  const compareMin = node.compareAtPriceRange?.minVariantPrice || null;
  const priceAmount = toNumber(minPrice?.amount);
  const compareAtPriceAmount = toNumber(compareMin?.amount);

  const variants = (node.variants?.edges || []).map(edge => {
    const variant = edge.node;
    const numericVariantId = extractNumericId(variant.id);
    const variantPriceAmount = toNumber(variant.price?.amount);
    const variantCompareAtAmount = toNumber(variant.compareAtPrice?.amount);

    const variantIsOnSale =
      variantCompareAtAmount !== null &&
      variantPriceAmount !== null &&
      variantCompareAtAmount > variantPriceAmount;

    return {
      id: variant.id,
      numericVariantId,
      title: variant.title || "Default Title",
      sku: variant.sku || null,
      availableForSale: variant.availableForSale,
      selectedOptions: variant.selectedOptions || [],
      price: variant.price ? `${variant.price.currencyCode} ${variant.price.amount}` : null,
      priceAmount: variantPriceAmount,
      compareAtPrice: variant.compareAtPrice
        ? `${variant.compareAtPrice.currencyCode} ${variant.compareAtPrice.amount}`
        : null,
      compareAtPriceAmount: variantCompareAtAmount,
      isOnSale: variantIsOnSale,
      addToCartUrl: buildCartUrl(numericVariantId, 1)
    };
  });

  const primaryVariant = variants.find(variant => variant.availableForSale) || variants[0] || null;
  const collections = (node.collections?.edges || []).map(e => e.node.handle);
  const collectionTitles = (node.collections?.edges || []).map(e => e.node.title);

  const isOnSale =
    compareAtPriceAmount !== null &&
    priceAmount !== null &&
    compareAtPriceAmount > priceAmount;

  return {
    id: node.id,
    numericProductId: extractNumericId(node.id),
    handle: node.handle,
    title: node.title,
    vendor: node.vendor || "",
    productType: node.productType || "",
    description: node.description || "",
    status: "ACTIVE",
    tags: node.tags || [],
    collections,
    collectionTitles,
    options: node.options || [],
    url: node.onlineStoreUrl || `https://${cleanDomain(SHOPIFY_PUBLIC_DOMAIN)}/products/${node.handle}`,
    image: node.featuredImage?.url || null,
    imageAltText: node.featuredImage?.altText || null,
    price: formatMoneyFromV2(minPrice),
    priceAmount,
    currencyCode: minPrice?.currencyCode || SHOPIFY_CURRENCY_CODE,
    compareAtPrice: formatMoneyFromV2(compareMin),
    compareAtPriceAmount,
    isOnSale,
    available: node.availableForSale,
    primaryVariant,
    variants,
    variantCount: variants.length,
    sku: primaryVariant?.sku || null,
    addToCartUrl: primaryVariant?.addToCartUrl || null,
    syncSource: "storefront_api"
  };
}

function mapAdminNode(node) {
  const minPrice = node.priceRangeV2?.minVariantPrice || null;
  const compareMin = node.compareAtPriceRange?.minVariantCompareAtPrice || null;
  const priceAmount = toNumber(minPrice?.amount);
  const compareAtPriceAmount = toNumber(compareMin?.amount);
  const currencyCode = minPrice?.currencyCode || SHOPIFY_CURRENCY_CODE;

  const variants = (node.variants?.edges || []).map(edge => {
    const variant = edge.node;
    const numericVariantId = extractNumericId(variant.legacyResourceId || variant.id);
    const variantPriceAmount = toNumber(variant.price);
    const variantCompareAtAmount = toNumber(variant.compareAtPrice);

    const variantIsOnSale =
      variantCompareAtAmount !== null &&
      variantPriceAmount !== null &&
      variantCompareAtAmount > variantPriceAmount;

    return {
      id: variant.id,
      numericVariantId,
      title: variant.title || "Default Title",
      sku: variant.sku || null,
      availableForSale: Boolean(variant.availableForSale),
      inventoryQuantity: variant.inventoryQuantity ?? null,
      sellableOnlineQuantity: variant.sellableOnlineQuantity ?? null,
      selectedOptions: variant.selectedOptions || [],
      price: formatMoneyScalar(variant.price, currencyCode),
      priceAmount: variantPriceAmount,
      compareAtPrice: formatMoneyScalar(variant.compareAtPrice, currencyCode),
      compareAtPriceAmount: variantCompareAtAmount,
      isOnSale: variantIsOnSale,
      addToCartUrl: buildCartUrl(numericVariantId, 1)
    };
  });

  const primaryVariant = variants.find(variant => variant.availableForSale) || variants[0] || null;
  const collections = (node.collections?.edges || []).map(e => e.node.handle);
  const collectionTitles = (node.collections?.edges || []).map(e => e.node.title);

  const isOnSale =
    compareAtPriceAmount !== null &&
    priceAmount !== null &&
    compareAtPriceAmount > priceAmount;

  return {
    id: node.id,
    numericProductId: extractNumericId(node.legacyResourceId || node.id),
    handle: node.handle,
    title: node.title,
    vendor: node.vendor || "",
    productType: node.productType || "",
    description: node.description || "",
    status: node.status || "",
    totalInventory: node.totalInventory ?? null,
    tracksInventory: node.tracksInventory ?? null,
    tags: node.tags || [],
    collections,
    collectionTitles,
    options: node.options || [],
    url: node.onlineStoreUrl || `https://${cleanDomain(SHOPIFY_PUBLIC_DOMAIN)}/products/${node.handle}`,
    image: node.featuredMedia?.image?.url || null,
    imageAltText: node.featuredMedia?.image?.altText || null,
    price: formatMoneyFromV2(minPrice),
    priceAmount,
    currencyCode,
    compareAtPrice: formatMoneyFromV2(compareMin),
    compareAtPriceAmount,
    isOnSale,
    available: variants.some(variant => variant.availableForSale),
    primaryVariant,
    variants,
    variantCount: variants.length,
    sku: primaryVariant?.sku || null,
    addToCartUrl: primaryVariant?.addToCartUrl || null,
    syncSource: "admin_api"
  };
}

async function syncViaStorefront({ verbose }) {
  const all = [];
  let cursor = null;
  let hasNext = true;
  let page = 0;

  while (hasNext) {
    let data;
    let attempt = 0;
    while (true) {
      try {
        data = await shopifyStorefrontGraphQL(STOREFRONT_CATALOG_QUERY, { cursor });
        break;
      } catch (err) {
        attempt += 1;
        if (attempt > 4) throw err;
        await sleep(1000 * attempt);
      }
    }

    const conn = data.products;
    for (const edge of conn.edges) all.push(mapStorefrontNode(edge.node));

    hasNext = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
    page += 1;
    if (verbose) console.log(`Catalog sync Storefront API: page ${page}, ${all.length} products so far`);
    await sleep(250);
  }

  return { products: all, source: "storefront_api" };
}

async function syncViaAdmin({ verbose }) {
  const all = [];
  let cursor = null;
  let hasNext = true;
  let page = 0;

  // Pull ACTIVE products. This should line up much better with your Shopify export.
  // If you ever want to include drafts/archived for analysis, change this query.
  const productQuery = process.env.SHOPIFY_ADMIN_PRODUCT_QUERY || "status:active";

  while (hasNext) {
    let data;
    let attempt = 0;
    while (true) {
      try {
        data = await shopifyAdminGraphQL(ADMIN_CATALOG_QUERY, { cursor, productQuery });
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
    if (verbose) console.log(`Catalog sync Admin API: page ${page}, ${all.length} active products so far`);
    await sleep(350);
  }

  return { products: all, source: "admin_api", productQuery };
}

// Pull every product from Shopify into the local index.
export async function syncCatalog({ verbose = true } = {}) {
  if (isSyncing) {
    return { skipped: true, reason: "A sync is already running." };
  }
  isSyncing = true;
  const startedAt = Date.now();

  try {
    const result = SHOPIFY_ADMIN_ACCESS_TOKEN
      ? await syncViaAdmin({ verbose })
      : await syncViaStorefront({ verbose });

    const all = result.products;

    // Commit to memory + disk.
    catalog = all;
    byHandle = new Map(all.map(p => [String(p.handle || "").toLowerCase(), p]));
    lastSync = new Date().toISOString();
    lastSyncSource = result.source;
    lastSummary = summarizeCatalog(all);

    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        CATALOG_PATH,
        JSON.stringify({ lastSync, lastSyncSource, products: all }, null, 0)
      );
    } catch (err) {
      console.warn("Could not persist catalog to disk:", err.message);
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (verbose) console.log(`Catalog sync complete using ${result.source}: ${all.length} products in ${seconds}s`);

    return { ok: true, source: result.source, productQuery: result.productQuery || null, count: all.length, seconds, lastSync, summary: lastSummary };
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
    byHandle = new Map(catalog.map(p => [String(p.handle || "").toLowerCase(), p]));
    lastSync = raw.lastSync || null;
    lastSyncSource = raw.lastSyncSource || catalog[0]?.syncSource || null;
    lastSummary = summarizeCatalog(catalog);
    console.log(`Loaded ${catalog.length} products from saved catalog (synced ${lastSync}, source ${lastSyncSource || "unknown"}).`);
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
  const withDescription = count(p => p.description && p.description.trim());
  const withCollections = count(p => (p.collections || []).length > 0);
  const onSale = count(p => p.isOnSale);
  const available = count(p => p.available);
  const active = count(p => !p.status || p.status === "ACTIVE");
  const variantTotal = list.reduce((sum, p) => sum + ((p.variants || []).length || 0), 0);
  const skuTotal = list.reduce((sum, p) => sum + (p.variants || []).filter(v => v.sku).length, 0);

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
    source: lastSyncSource || list[0]?.syncSource || null,
    coverage: {
      productType: { count: withType, pct: pct(withType) },
      tags: { count: withTags, pct: pct(withTags) },
      image: { count: withImage, pct: pct(withImage) },
      description: { count: withDescription, pct: pct(withDescription) },
      collections: { count: withCollections, pct: pct(withCollections) },
      active: { count: active, pct: pct(active) },
      available: { count: available, pct: pct(available) },
      onSale: { count: onSale, pct: pct(onSale) }
    },
    skus: { totalVariantRecords: variantTotal, withSku: skuTotal },
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
export function getLastSyncSource() {
  return lastSyncSource;
}
export function getLastSummary() {
  return lastSummary || summarizeCatalog(catalog);
}
export function getByHandle(handle) {
  return byHandle.get(String(handle || "").toLowerCase()) || null;
}
export function getAllProducts() {
  return catalog;
}
