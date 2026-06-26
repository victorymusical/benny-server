const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;

// Customer-facing domain for links shown in chat (e.g. victorymusical.com).
// Falls back to the store domain if not set. Set SHOPIFY_PUBLIC_DOMAIN in
// Railway to "victorymusical.com" so the dev myshopify.com URL never shows.
const SHOPIFY_PUBLIC_DOMAIN = process.env.SHOPIFY_PUBLIC_DOMAIN || SHOPIFY_STORE_DOMAIN;

function formatMoney(money) {
  if (!money) return null;
  return `${money.currencyCode} ${money.amount}`;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractNumericId(gid) {
  if (!gid) return null;
  return String(gid).split("/").pop();
}

function buildCartUrl(numericVariantId, quantity = 1) {
  if (!numericVariantId) return null;
  return `https://${SHOPIFY_PUBLIC_DOMAIN}/cart/${numericVariantId}:${quantity}`;
}

// Shared GraphQL fragment so search and collection results have identical shape.
const PRODUCT_FIELDS = `
  title
  handle
  vendor
  productType
  description
  tags
  onlineStoreUrl
  featuredImage { url altText }
  priceRange {
    minVariantPrice { amount currencyCode }
    maxVariantPrice { amount currencyCode }
  }
  compareAtPriceRange {
    minVariantPrice { amount currencyCode }
    maxVariantPrice { amount currencyCode }
  }
  variants(first: 10) {
    edges {
      node {
        id
        title
        availableForSale
        sku
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
      }
    }
  }
`;

function mapProductNode(product) {
  const minPrice = product.priceRange?.minVariantPrice || null;
  const compareAtMinPrice = product.compareAtPriceRange?.minVariantPrice || null;

  const priceAmount = toNumber(minPrice?.amount);
  const compareAtPriceAmount = toNumber(compareAtMinPrice?.amount);

  const variants = (product.variants?.edges || []).map(v => {
    const variant = v.node;
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
      title: variant.title,
      sku: variant.sku,
      availableForSale: variant.availableForSale,
      price: formatMoney(variant.price),
      priceAmount: variantPriceAmount,
      compareAtPrice: formatMoney(variant.compareAtPrice),
      compareAtPriceAmount: variantCompareAtAmount,
      isOnSale: variantIsOnSale,
      addToCartUrl: buildCartUrl(numericVariantId, 1)
    };
  });

  const primaryVariant =
    variants.find(variant => variant.availableForSale) || variants[0] || null;

  const isOnSale =
    compareAtPriceAmount !== null &&
    priceAmount !== null &&
    compareAtPriceAmount > priceAmount;

  return {
    title: product.title,
    handle: product.handle,
    vendor: product.vendor,
    productType: product.productType,
    description: product.description,
    tags: product.tags,
    url:
      product.onlineStoreUrl ||
      `https://${SHOPIFY_PUBLIC_DOMAIN}/products/${product.handle}`,
    image: product.featuredImage?.url || null,
    price: formatMoney(minPrice),
    priceAmount,
    compareAtPrice: formatMoney(compareAtMinPrice),
    compareAtPriceAmount,
    isOnSale,
    primaryVariant,
    addToCartUrl: primaryVariant?.addToCartUrl || null,
    variants
  };
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
    console.error("Shopify errors:", data.errors);
    throw new Error("Shopify request failed.");
  }

  return data.data;
}

// Free-text product search across the whole store.
export async function searchShopifyProducts(query, limit = 5) {
  const graphqlQuery = `
    query SearchProducts($query: String!, $first: Int!) {
      products(first: $first, query: $query) {
        edges { node { ${PRODUCT_FIELDS} } }
      }
    }
  `;

  const data = await shopifyGraphQL(graphqlQuery, { query, first: limit });
  return (data.products?.edges || []).map(edge => mapProductNode(edge.node));
}

// Products from a specific collection (authoritative for a category browse).
// Returns [] if the collection handle does not exist, so callers can fall back.
export async function getCollectionProducts(handle, limit = 30) {
  if (!handle) return [];

  const graphqlQuery = `
    query CollectionProducts($handle: String!, $first: Int!) {
      collection(handle: $handle) {
        title
        products(first: $first) {
          edges { node { ${PRODUCT_FIELDS} } }
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphQL(graphqlQuery, { handle, first: limit });
    const edges = data.collection?.products?.edges || [];
    return edges.map(edge => mapProductNode(edge.node));
  } catch (error) {
    console.warn(`Collection fetch failed for "${handle}":`, error.message);
    return [];
  }
}
