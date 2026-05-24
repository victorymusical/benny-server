import { searchShopifyProducts } from "./shopify.js";

export async function getVendorsForCategory(category) {
  if (!category) {
    return [];
  }

  const products = await searchShopifyProducts(category, 50);

  const vendors = [
    ...new Set(
      products
        .map(product => product.vendor)
        .filter(Boolean)
        .map(vendor => vendor.trim())
    )
  ];

  return vendors.sort();
}
