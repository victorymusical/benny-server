import { findTaxonomyCategory, normalizeText } from "./taxonomy.js";

const GLOBAL_ACCESSORY_TERMS = [
  "case",
  "bag",
  "cable",
  "stand",
  "strings",
  "string",
  "mouthpiece",
  "ligature",
  "reed",
  "reeds",
  "cleaning",
  "oil",
  "grease",
  "adapter",
  "mount",
  "cap",
  "strap",
  "mute",
  "power supply",
  "charger",
  "parts"
];

const CASE_BRANDS = [
  "jean & nick",
  "jean and nick"
];

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

export function isAccessoryProduct(product = {}) {
  const text = normalizeText(productText(product));

  return GLOBAL_ACCESSORY_TERMS.some(term =>
    text.includes(normalizeText(term))
  );
}

export function isCaseBrand(product = {}) {
  const vendor = normalizeText(product.vendor || "");

  return CASE_BRANDS.some(brand => vendor.includes(normalizeText(brand)));
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

  const text = normalizeText(productText(product));
  const productType = normalizeText(product.productType || "");
  const title = normalizeText(product.title || "");

  const accessory = isAccessoryProduct(product);
  const caseBrand = isCaseBrand(product);

  if (caseBrand) {
    return {
      classification: "accessory",
      reason: "Jean & Nick is treated as a cases/accessories brand unless explicitly verified otherwise.",
      taxonomyCategory: taxonomy?.canonicalCategory || null
    };
  }

  if (!taxonomy) {
    return {
      classification: accessory ? "accessory" : "unknown",
      reason: accessory
        ? "Product appears to be an accessory."
        : "No taxonomy match was found for this request.",
      taxonomyCategory: null
    };
  }

  const excludedTerms = [
    ...(taxonomy.excludeAccessoryTerms || []),
    ...GLOBAL_ACCESSORY_TERMS
  ];

  const hasExcludedTerm = excludedTerms.some(term =>
    title.includes(normalizeText(term))
  );

  if (hasExcludedTerm && taxonomy.canonicalCategory !== "Cables") {
    return {
      classification: "accessory",
      reason: "Product title or product data indicates this is an accessory, not the main requested product.",
      taxonomyCategory: taxonomy.canonicalCategory
    };
  }

  const categoryHints = [
    taxonomy.canonicalCategory,
    ...(taxonomy.aliases || []),
    ...(taxonomy.productTypeHints || [])
  ].map(normalizeText);

  const strongMatch = categoryHints.some(hint => {
    return (
      productType.includes(hint) ||
      title.includes(hint)
    );
  });

  const weakMatch = categoryHints.some(hint => text.includes(hint));

  if (strongMatch) {
    return {
      classification: "main_product",
      reason: "Product type or title strongly matches the requested category.",
      taxonomyCategory: taxonomy.canonicalCategory
    };
  }

  if (weakMatch && !accessory) {
    return {
      classification: "possible_match",
      reason: "Product text references the requested category but needs caution.",
      taxonomyCategory: taxonomy.canonicalCategory
    };
  }

  if (accessory) {
    return {
      classification: "accessory",
      reason: "Product appears to be an accessory.",
      taxonomyCategory: taxonomy.canonicalCategory
    };
  }

  return {
    classification: "unrelated",
    reason: "Product does not appear to match the requested primary category.",
    taxonomyCategory: taxonomy.canonicalCategory
  };
}

export function validateProductGroups(productGroups = []) {
  return productGroups.map(group => {
    const products = group.products || [];

    const validatedProducts = products.map(product => {
      const validation = classifyProductForRequest(
        product,
        group.requestedItem || {}
      );

      return {
        ...product,
        validation
      };
    });

    return {
      ...group,
      products: validatedProducts,
      mainProducts: validatedProducts.filter(
        product => product.validation.classification === "main_product"
      ),
      possibleMatches: validatedProducts.filter(
        product => product.validation.classification === "possible_match"
      ),
      accessories: validatedProducts.filter(
        product => product.validation.classification === "accessory"
      ),
      unrelated: validatedProducts.filter(
        product => product.validation.classification === "unrelated"
      )
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
