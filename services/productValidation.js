// productValidation.js
//
// What changed in v1:
// 1. Validation is no longer a GATE that hides products. It is now a SCORE that
//    ranks products best-first. Nothing the store returned is thrown away.
//    This is the core fix for "Benny says we don't carry something we do."
// 2. Accessories are pushed DOWN, not deleted, and only when the customer was
//    NOT asking for an accessory in the first place.
// 3. The over-aggressive accessory keywords ("string", "cap", "oil", "parts")
//    that flagged real products are gone. Accessory detection now uses whole
//    words and leans on product type and title.
// 4. New helper buildRecommendedProducts() returns ONE clean, ranked list with
//    only the fields the AI and the product cards actually need.

import { findTaxonomyCategory, normalizeText, phraseInText } from "./taxonomy.js";

// Words that indicate a product is an accessory. Whole-word matched.
const ACCESSORY_TERMS = [
  "case", "cases", "gig bag", "bag", "bags",
  "cable", "cables", "adapter", "adapters",
  "stand", "stands", "mount", "mounts", "bracket",
  "strings", "string set",
  "mouthpiece", "mouthpieces", "ligature", "reed", "reeds",
  "cleaning kit", "cleaning cloth", "polish",
  "valve oil", "slide oil", "slide grease", "rosin",
  "strap", "straps", "mute", "mutes",
  "power supply", "charger", "battery",
  "shock mount", "pop filter", "windscreen", "clip",
  "pick", "picks", "capo", "stick", "sticks",
  "pedal", "bench", "throne", "ear pads", "pads",
  "shoulder rest", "chin rest", "bow"
];

const CASE_BRANDS = ["jean & nick", "jean and nick"];

function productText(product = {}) {
  return [
    product.title,
    product.vendor,
    product.productType,
    product.description,
    ...(product.tags || [])
  ]
    .filter(Boolean)
    .join(" ");
}

// Tokens worth matching against a product title (skip tiny/filler words).
function significantTokens(text = "") {
  const stop = new Set(["the", "and", "for", "with", "a", "an", "of", "to", "in", "by", "or"]);
  return normalizeText(text)
    .split(" ")
    .filter(t => t.length >= 2 && !stop.has(t));
}

export function isLikelyAccessory(product = {}) {
  const title = normalizeText(product.title || "");
  const type = normalizeText(product.productType || "");

  // Prefer product type when it is clearly an accessory type.
  const inType = ACCESSORY_TERMS.some(term => phraseInText(type, term));
  if (inType) return true;

  return ACCESSORY_TERMS.some(term => phraseInText(title, term));
}

export function isCaseBrand(product = {}) {
  const vendor = normalizeText(product.vendor || "");
  return CASE_BRANDS.some(brand => vendor.includes(normalizeText(brand)));
}

// Was the customer actually asking for an accessory? If so we do not demote them.
export function requestIsForAccessory(requestedItem = {}, taxonomy = null) {
  if (taxonomy && taxonomy.isAccessoryCategory) return true;

  const text = [requestedItem.product, requestedItem.category, requestedItem.searchQuery]
    .filter(Boolean)
    .join(" ");

  return ACCESSORY_TERMS.some(term => phraseInText(text, term));
}

// Score how well a product matches what the customer asked for. Higher is better.
export function scoreProduct(product = {}, requestedItem = {}, taxonomy = null) {
  let score = 0;

  const title = normalizeText(product.title || "");
  const type = normalizeText(product.productType || "");
  const vendor = normalizeText(product.vendor || "");
  const fullText = normalizeText(productText(product));

  // Brand match.
  if (requestedItem.brand) {
    const brand = normalizeText(requestedItem.brand);
    if (brand && (vendor.includes(brand) || title.includes(brand))) score += 35;
  }

  // Model / product token matches in the title.
  const modelTokens = [
    ...significantTokens(requestedItem.product || ""),
    ...significantTokens(requestedItem.searchQuery || "")
  ];
  const uniqueModelTokens = [...new Set(modelTokens)];
  let tokenHits = 0;
  for (const token of uniqueModelTokens) {
    if (title.includes(token)) tokenHits += 1;
  }
  score += Math.min(tokenHits * 15, 45);

  // Category match via taxonomy hints.
  if (taxonomy) {
    const hints = [
      taxonomy.canonicalCategory,
      ...(taxonomy.aliases || []),
      ...(taxonomy.productTypeHints || [])
    ];

    const strong = hints.some(h => phraseInText(type, h) || phraseInText(title, h));
    const weak = hints.some(h => phraseInText(fullText, h));

    if (strong) score += 25;
    else if (weak) score += 8;
  }

  // Tiny tiebreak for in-stock items.
  if (product.primaryVariant && product.primaryVariant.availableForSale) score += 3;

  return score;
}

export function classifyProductForRequest(product = {}, requestedItem = {}) {
  const requestText = [
    requestedItem.brand,
    requestedItem.product,
    requestedItem.category,
    requestedItem.searchQuery
  ]
    .filter(Boolean)
    .join(" ");

  const taxonomy = findTaxonomyCategory(requestText);
  const score = scoreProduct(product, requestedItem, taxonomy);
  const accessory = isLikelyAccessory(product) || isCaseBrand(product);

  let label;
  if (score >= 45) label = "strong_match";
  else if (score >= 20) label = "possible_match";
  else label = "weak_match";
  if (accessory) label = "accessory";

  return {
    score,
    isAccessory: accessory,
    label,
    taxonomyCategory: taxonomy ? taxonomy.canonicalCategory : null
  };
}

export function validateProductGroups(productGroups = []) {
  return productGroups.map(group => {
    const requestedItem = group.requestedItem || {};
    const taxonomy = findTaxonomyCategory(
      [requestedItem.brand, requestedItem.product, requestedItem.category, requestedItem.searchQuery]
        .filter(Boolean)
        .join(" ")
    );
    const wantsAccessory = requestIsForAccessory(requestedItem, taxonomy);

    const products = (group.products || []).map(product => ({
      ...product,
      validation: classifyProductForRequest(product, requestedItem)
    }));

    // Rank: if they want an accessory, pure score. Otherwise real products
    // first, accessories after, each sorted by score.
    const ranked = [...products].sort((a, b) => {
      if (!wantsAccessory && a.validation.isAccessory !== b.validation.isAccessory) {
        return a.validation.isAccessory ? 1 : -1;
      }
      return b.validation.score - a.validation.score;
    });

    return {
      ...group,
      wantsAccessory,
      products: ranked,
      mainProducts: ranked.filter(p => !p.validation.isAccessory),
      accessories: ranked.filter(p => p.validation.isAccessory)
    };
  });
}

export function flattenValidatedProducts(validatedGroups = []) {
  return validatedGroups.flatMap(group => group.products || []);
}

export function getMainProducts(validatedGroups = []) {
  return validatedGroups.flatMap(group => group.mainProducts || []);
}

export function getAccessories(validatedGroups = []) {
  return validatedGroups.flatMap(group => group.accessories || []);
}

// Trim a product down to only what the AI and the product cards need.
function slimProduct(product = {}) {
  const v = product.primaryVariant || null;
  return {
    title: product.title,
    vendor: product.vendor,
    productType: product.productType,
    url: product.url,
    image: product.image,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    isOnSale: product.isOnSale,
    available: v ? v.availableForSale : null,
    sku: v ? v.sku : null,
    addToCartUrl: product.addToCartUrl || (v ? v.addToCartUrl : null),
    matchLabel: product.validation ? product.validation.label : null,
    matchScore: product.validation ? product.validation.score : null
  };
}

// ONE clean, ranked, de-duplicated list of products to recommend.
export function buildRecommendedProducts(validatedGroups = [], limit = 8) {
  const seen = new Map();

  for (const group of validatedGroups) {
    for (const product of group.products || []) {
      const handle = product.handle || product.url;
      if (!handle) continue;

      const existing = seen.get(handle);
      const score = product.validation ? product.validation.score : 0;

      if (!existing || score > existing.validation.score) {
        seen.set(handle, product);
      }
    }
  }

  const all = [...seen.values()].sort((a, b) => {
    const aAcc = a.validation ? a.validation.isAccessory : false;
    const bAcc = b.validation ? b.validation.isAccessory : false;
    if (aAcc !== bAcc) return aAcc ? 1 : -1;
    const aScore = a.validation ? a.validation.score : 0;
    const bScore = b.validation ? b.validation.score : 0;
    return bScore - aScore;
  });

  return all.slice(0, limit).map(slimProduct);
}
