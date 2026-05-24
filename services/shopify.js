const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;

export async function searchShopifyProducts(query, limit = 5) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    throw new Error("Missing Shopify environment variables.");
  }

  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/api/2025-10/graphql.json`;

  const graphqlQuery = `
    query SearchProducts($query: String!, $first: Int!) {
      products(first: $first, query: $query) {
        edges {
          node {
            title
            handle
            vendor
            productType
            description
            tags
            onlineStoreUrl
            featuredImage {
              url
              altText
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            variants(first: 5) {
              edges {
                node {
                  title
                  availableForSale
                  sku
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_ACCESS_TOKEN
    },
    body: JSON.stringify({
      query: graphqlQuery,
      variables: {
        query,
        first: limit
      }
    })
  });

  const data = await response.json();

  if (data.errors) {
    console.error("Shopify errors:", data.errors);
    throw new Error("Shopify product search failed.");
  }

  return data.data.products.edges.map(edge => {
    const product = edge.node;

    return {
      title: product.title,
      handle: product.handle,
      vendor: product.vendor,
      productType: product.productType,
      description: product.description,
      tags: product.tags,
      url: product.onlineStoreUrl || `https://${SHOPIFY_STORE_DOMAIN}/products/${product.handle}`,
      image: product.featuredImage?.url || null,
      price: product.priceRange?.minVariantPrice
        ? `${product.priceRange.minVariantPrice.currencyCode} ${product.priceRange.minVariantPrice.amount}`
        : null,
      variants: product.variants.edges.map(v => ({
        title: v.node.title,
        sku: v.node.sku,
        availableForSale: v.node.availableForSale,
        price: `${v.node.price.currencyCode} ${v.node.price.amount}`
      }))
    };
  });
}
