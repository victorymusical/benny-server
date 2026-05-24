import { searchShopifyProducts } from "./shopify.js";

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ");
}

function isAudioInterfaceProduct(product) {
  const productType = normalize(product.productType);
  const tags = (product.tags || []).map(tag => normalize(tag));

  return (
    productType === "audio interface" ||
    productType === "audio interfaces" ||
    tags.includes("audio interface") ||
    tags.includes("audio interfaces")
  );
}

function filterProductsByCategory(products, category) {
  const normalizedCategory = normalize(category);

  if (
    normalizedCategory === "audio interface" ||
    normalizedCategory === "audio interfaces"
  ) {
    return products.filter(isAudioInterfaceProduct);
  }

  return products;
}

export async function getVendorsForCategory(category) {
  if (!category) {
    return [];
  }

  const products = await searchShopifyProducts(category, 50);

  const filteredProducts = filterProductsByCategory(products, category);

  const vendors = [
    ...new Set(
      filteredProducts
        .map(product => product.vendor)
        .filter(Boolean)
        .map(vendor => vendor.trim())
    )
  ];

  return vendors.sort();
}
