// shopifyAuth.js
//
// Gets an Admin API access token using the OAuth "client credentials" grant.
//
// Why this exists: Shopify removed the old static Admin token you used to copy
// out of the admin. Modern apps exchange a Client ID + Secret for a token that
// expires after 24 hours. This module does that exchange and caches the token,
// refreshing it automatically before it expires. You never touch it.
//
// Required Railway variables:
//   SHOPIFY_STORE_DOMAIN         e.g. llord-music.myshopify.com
//   SHOPIFY_ADMIN_CLIENT_ID      from Shopify Dev Dashboard > your app > Settings
//   SHOPIFY_ADMIN_CLIENT_SECRET  same place (keep secret!)
//
// IMPORTANT: client_credentials only works when the app and the store are in the
// SAME Shopify organization. If you get a 401 here, that's the first thing to check.

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const CLIENT_ID = process.env.SHOPIFY_ADMIN_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;

// Cached token
let cachedToken = null;
let expiresAt = 0; // epoch ms

export function hasAdminCredentials() {
  return Boolean(SHOPIFY_STORE_DOMAIN && CLIENT_ID && CLIENT_SECRET);
}

// Fetch a fresh Admin API access token from Shopify.
async function requestNewToken() {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;

  // NOTE: Shopify requires form-urlencoded here, NOT JSON. JSON silently fails.
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET
  }).toString();

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Shopify token request failed (${response.status}). ` +
      `Most common cause: the app and the store are not in the same Shopify organization, ` +
      `or read_products scope is not enabled. Response: ${text.slice(0, 200)}`
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Shopify returned a non-JSON token response.");
  }

  if (!data.access_token) {
    throw new Error("Shopify did not return an access_token.");
  }

  // Tokens last ~24h. Refresh 30 min early so we never use a stale one.
  const lifetimeSeconds = Number(data.expires_in || 86400);
  cachedToken = data.access_token;
  expiresAt = Date.now() + (lifetimeSeconds - 1800) * 1000;

  console.log("Shopify Admin token acquired. Expires in ~" + Math.round(lifetimeSeconds / 3600) + "h.");
  return cachedToken;
}

// Return a valid token, refreshing only when needed.
export async function getAdminToken() {
  if (!hasAdminCredentials()) {
    throw new Error("Missing Shopify Admin client credentials.");
  }
  if (cachedToken && Date.now() < expiresAt) {
    return cachedToken;
  }
  return requestNewToken();
}

// Call the Admin GraphQL API with an auto-refreshed token.
export async function adminGraphQL(query, variables = {}) {
  const token = await getAdminToken();
  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-10/graphql.json`;

  let response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });

  // If the token went stale early, force one refresh and retry once.
  if (response.status === 401) {
    cachedToken = null;
    expiresAt = 0;
    const fresh = await getAdminToken();
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": fresh
      },
      body: JSON.stringify({ query, variables })
    });
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error("Shopify Admin error: " + JSON.stringify(data.errors).slice(0, 300));
  }

  return data.data;
}

// Simple diagnostic: can we authenticate, and what can we see?
export async function checkAdminAuth() {
  if (!hasAdminCredentials()) {
    return {
      ok: false,
      mode: "storefront_only",
      reason: "SHOPIFY_ADMIN_CLIENT_ID / SHOPIFY_ADMIN_CLIENT_SECRET not set."
    };
  }

  try {
    const data = await adminGraphQL(`
      query { shop { name myshopifyDomain } productsCount { count } }
    `);
    return {
      ok: true,
      mode: "admin_api",
      shop: data.shop?.name,
      domain: data.shop?.myshopifyDomain,
      totalProducts: data.productsCount?.count ?? null
    };
  } catch (error) {
    return { ok: false, mode: "admin_failed", reason: error.message };
  }
}
