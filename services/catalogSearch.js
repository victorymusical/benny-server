// catalogSearch.js
//
// Benny's local product retrieval layer.
//
// This is intentionally dependency-free. It searches the synced Shopify catalog
// in memory before Benny talks to the AI, so product recommendations come from
// Victory's real catalog instead of from the model's memory.

import { getAllProducts } from "./catalog.js";
import { findTaxonomyCategory, phraseInText } from "./taxonomy.js";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "but", "by", "can", "do",
  "does", "for", "from", "get", "good", "have", "i", "in", "is", "it", "me",
  "my", "need", "of", "on", "or", "our", "please", "recommend", "show", "that",
  "the", "this", "to", "want", "we", "what", "which", "with", "you"
]);

const ACCESSORY_TERMS = [
  "case", "cases", "gig bag", "bag", "bags", "cable", "cables", "adapter", "adapters",
  "stand", "stands", "mount", "mounts", "bracket", "mouthpiece", "mouthpieces",
  "ligature", "reed", "reeds", "cleaning kit", "cleaning cloth", "valve oil",
  "slide grease", "rosin", "strap", "straps", "mute", "mutes", "power supply",
  "charger", "battery", "shock mount", "pop filter", "windscreen", "picks",
  "capo", "sticks", "pedal", "bench", "throne", "bow"
];

// Use-case terms are not fake products. They only help rank real catalog items
// that already exist. This helps questions like "mic for tuba in Mexican banda"
// find clip-on / instrument / high-SPL microphones without hard-coding a SKU.
const USE_CASE_BOOSTS = [
  {
    when: ["tuba", "mic"],
    boostTerms: ["clip", "clip on", "clip-on", "instrument", "brass", "horn", "gooseneck", "dynamic", "wireless", "bodypack", "high spl"]
  },
  {
    when: ["tuba", "microphone"],
    boostTerms: ["clip", "clip on", "clip-on", "instrument", "brass", "horn", "gooseneck", "dynamic", "wireless", "bodypack", "high spl"]
  },
  {
    when: ["sax", "mic"],
    boostTerms: ["clip", "clip on", "clip-on", "instrument", "horn", "gooseneck", "wireless", "bodypack"]
  },
  {
    when: ["trumpet", "mic"],
    boostTerms: ["clip", "clip on", "clip-on", "instrument", "brass", "horn", "gooseneck", "dynamic", "wireless", "bodypack", "high spl"]
  },
  {
    when: ["church", "speaker"],
    boostTerms: ["loudspeaker", "powered", "active", "pa", "subwoofer", "line array", "column"]
  },
  {
    when: ["church", "camera"],
    boostTerms: ["ptz", "streaming", "broadcast", "ndi", "sdi", "hdmi"]
  },
  {
    when: ["record", "drums"],
    boostTerms: ["interface", "preamp", "8 channel", "adat", "thunderbolt", "usb"]
  }
];

function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value = "") {
  return normalize(value).replace(/ /g, "");
}

function tokens(value = "") {
  return normalize(value)
    .split(" ")
    .filter(token => token.length >= 2 && !STOPWORDS.has(token));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function productVariantText(product = {}) {
  return (product.variants || [])
    .flatMap(variant => [
      variant.title,
      variant.sku,
      ...(variant.selectedOptions || []).flatMap(option => [option.name, option.value])
    ])
    .filter(Boolean)
    .join(" ");
}

function productOptionText(product = {}) {
  return (product.options || [])
    .flatMap(option => [option.name, ...(option.values || [])])
    .filter(Boolean)
    .join(" ");
}

function productHaystack(product = {}) {
  return [
    product.title,
    product.vendor,
    product.productType,
    product.description,
    ...(product.tags || []),
    ...(product.collections || []),
    ...(product.collectionTitles || []),
    product.sku,
    productVariantText(product),
    productOptionText(product)
  ]
    .filter(Boolean)
    .join(" ");
}

function productIsLikelyAccessory(product = {}) {
  const title = normalize(product.title || "");
  const type = normalize(product.productType || "");
  return ACCESSORY_TERMS.some(term => phraseInText(title, term) || phraseInText(type, term));
}

function requestIsForAccessory(requestedItem = {}, taxonomy = null) {
  if (taxonomy?.isAccessoryCategory) return true;
  const text = [requestedItem.product, requestedItem.category, requestedItem.searchQuery]
    .filter(Boolean)
    .join(" ");
  return ACCESSORY_TERMS.some(term => phraseInText(text, term));
}

function queryTextFromGroup(queryGroup = {}) {
  const item = queryGroup.requestedItem || {};
  return unique([
    item.brand,
    item.product,
    item.category,
    item.searchQuery,
    queryGroup.taxonomyCategory,
    ...(queryGroup.searchQueries || [])
  ]).join(" ");
}

function getUseCaseBoostTerms(queryText = "") {
  const normalized = normalize(queryText);
  const terms = [];

  for (const rule of USE_CASE_BOOSTS) {
    const matched = rule.when.every(term => phraseInText(normalized, term));
    if (matched) terms.push(...rule.boostTerms);
  }

  return unique(terms);
}

function variantSkuMatch(product = {}, normalizedQuery = "", compactQuery = "") {
  for (const variant of product.variants || []) {
    const sku = normalize(variant.sku || "");
    if (!sku) continue;
    if (sku === normalizedQuery || compact(sku) === compactQuery) return true;
  }

  const productSku = normalize(product.sku || "");
  return Boolean(productSku && (productSku === normalizedQuery || compact(productSku) === compactQuery));
}

export function scoreCatalogProduct(product = {}, queryGroup = {}) {
  const requestedItem = queryGroup.requestedItem || {};
  const rawQueryText = queryTextFromGroup(queryGroup);
  const normalizedQuery = normalize(rawQueryText);
  const compactQuery = compact(rawQueryText);
  const taxonomy =
    findTaxonomyCategory(rawQueryText) ||
    (queryGroup.taxonomyCategory ? findTaxonomyCategory(queryGroup.taxonomyCategory) : null);

  const title = normalize(product.title || "");
  const vendor = normalize(product.vendor || "");
  const type = normalize(product.productType || "");
  const handle = normalize(product.handle || "");
  const haystack = normalize(productHaystack(product));

  let score = 0;
  const reasons = [];

  if (!normalizedQuery || !haystack) return { score: 0, reasons };

  // Exact identifiers should dominate everything.
  if (handle && (handle === normalizedQuery || compact(handle) === compactQuery)) {
    score += 1000;
    reasons.push("exact handle");
  }

  if (variantSkuMatch(product, normalizedQuery, compactQuery)) {
    score += 950;
    reasons.push("exact SKU");
  }

  // Direct phrase matches.
  const directPhrases = unique([
    requestedItem.searchQuery,
    requestedItem.product,
    [requestedItem.brand, requestedItem.product].filter(Boolean).join(" ")
  ]).map(normalize).filter(Boolean);

  for (const phrase of directPhrases) {
    if (!phrase || phrase.length < 2) continue;
    if (title === phrase) {
      score += 350;
      reasons.push(`title exact: ${phrase}`);
    } else if (phraseInText(title, phrase)) {
      score += 180;
      reasons.push(`title phrase: ${phrase}`);
    } else if (phraseInText(haystack, phrase)) {
      score += 60;
      reasons.push(`catalog phrase: ${phrase}`);
    }
  }

  // Brand/vendor match.
  if (requestedItem.brand) {
    const brand = normalize(requestedItem.brand);
    if (brand && (phraseInText(vendor, brand) || phraseInText(title, brand))) {
      score += 90;
      reasons.push("brand match");
    }
  }

  // Category/taxonomy match.
  if (taxonomy) {
    if (taxonomy.collectionHandle && (product.collections || []).includes(taxonomy.collectionHandle)) {
      score += 120;
      reasons.push("collection match");
    }

    const hints = unique([
      taxonomy.canonicalCategory,
      ...(taxonomy.aliases || []),
      ...(taxonomy.productTypeHints || [])
    ]).map(normalize).filter(Boolean);

    for (const hint of hints) {
      if (phraseInText(type, hint)) {
        score += 80;
        reasons.push(`type match: ${hint}`);
        break;
      }
      if (phraseInText(title, hint)) {
        score += 65;
        reasons.push(`title category: ${hint}`);
        break;
      }
    }

    if (!reasons.some(reason => reason.includes("type match") || reason.includes("title category"))) {
      for (const hint of hints.slice(0, 12)) {
        if (phraseInText(haystack, hint)) {
          score += 25;
          reasons.push(`catalog category: ${hint}`);
          break;
        }
      }
    }
  }

  // Token match. This gives broad search recall without letting random tiny words win.
  const queryTokens = unique(tokens(rawQueryText));
  let titleHits = 0;
  let typeHits = 0;
  let vendorHits = 0;
  let fullHits = 0;

  for (const token of queryTokens) {
    if (phraseInText(title, token)) titleHits += 1;
    if (phraseInText(type, token)) typeHits += 1;
    if (phraseInText(vendor, token)) vendorHits += 1;
    if (phraseInText(haystack, token)) fullHits += 1;
  }

  score += Math.min(titleHits * 18, 90);
  score += Math.min(typeHits * 16, 64);
  score += Math.min(vendorHits * 14, 56);
  score += Math.min(fullHits * 4, 48);

  if (titleHits || typeHits || vendorHits || fullHits) {
    reasons.push(`token hits t:${titleHits} ty:${typeHits} v:${vendorHits} f:${fullHits}`);
  }

  // Practical use-case boost, still tied to actual catalog text.
  for (const boostTerm of getUseCaseBoostTerms(rawQueryText)) {
    if (phraseInText(haystack, boostTerm)) {
      score += 18;
      reasons.push(`use-case: ${boostTerm}`);
    }
  }

  // If the customer wants a main product, do not let accessories win just because
  // the search contains words like "mic" or "cable". If they asked for an accessory,
  // this penalty is removed.
  const wantsAccessory = requestIsForAccessory(requestedItem, taxonomy);
  if (!wantsAccessory && productIsLikelyAccessory(product)) {
    score -= 80;
    reasons.push("accessory demotion");
  }

  if (product.available === true || product.primaryVariant?.availableForSale === true) score += 5;
  if (product.isOnSale) score += 2;

  return { score, reasons: reasons.slice(0, 8) };
}

export function searchCatalogForQueryGroup(queryGroup = {}, { limit = 80, minScore = 20 } = {}) {
  const catalog = getAllProducts();
  if (!catalog.length) return [];

  return catalog
    .map(product => {
      const result = scoreCatalogProduct(product, queryGroup);
      return {
        ...product,
        catalogSearch: result
      };
    })
    .filter(product => product.catalogSearch.score >= minScore)
    .sort((a, b) => b.catalogSearch.score - a.catalogSearch.score)
    .slice(0, limit);
}

export function searchCatalogProducts(queryGroups = [], { limitPerGroup = 80, minScore = 20 } = {}) {
  return queryGroups.map(queryGroup => ({
    requestedItem: queryGroup.requestedItem,
    taxonomyCategory: queryGroup.taxonomyCategory,
    collectionHandle: queryGroup.collectionHandle,
    source: "local_catalog",
    products: searchCatalogForQueryGroup(queryGroup, { limit: limitPerGroup, minScore })
  }));
}
