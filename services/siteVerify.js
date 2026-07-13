// siteVerify.js — the SECOND opinion.
//
// Melvin's rule: never trust one source. Before Benny tells a customer he
// can't find something, he checks the live public site too — the same way a
// person (or ChatGPT) would search victorymusical.com.
//
// This fires ONLY on the negative path: when Benny is about to say no.
// That's the moment he most needs to be right, and it's rare enough that the
// extra second costs nothing on normal questions.
//
// It answers ONE question: does this exist on the site, yes or no?
// It does not browse, reason, or scrape specs. Tight lookup, clear answer.

const PUBLIC_DOMAIN = process.env.SHOPIFY_PUBLIC_DOMAIN || "www.victorymusical.com";

const TIMEOUT_MS = 6000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "BennyBot/1.0 (Victory Musical Instruments)" }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search the live storefront for a term.
 * Uses Shopify's built-in predictive search JSON endpoint — fast and reliable.
 * Returns real products found on the public site, or [] if none.
 */
export async function searchLiveSite(query, limit = 6) {
  if (!query || !query.trim()) return [];

  const url =
    `https://${PUBLIC_DOMAIN}/search/suggest.json` +
    `?q=${encodeURIComponent(query)}` +
    `&resources[type]=product&resources[limit]=${limit}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];

    const data = await res.json();
    const products = data?.resources?.results?.products || [];

    return products.map(p => ({
      title: p.title,
      handle: p.handle,
      url: p.url ? `https://${PUBLIC_DOMAIN}${p.url}` : null,
      image: p.image || null,
      price: p.price || null,
      vendor: p.vendor || null,
      foundVia: "live_site"
    }));
  } catch (err) {
    console.warn(`Live site check failed for "${query}":`, err.message);
    return []; // Fail soft. A failed check must never become a false "we don't have it."
  }
}

/**
 * The honest-answer gate.
 *
 * Benny may only say "I can't find that" if BOTH the local index AND the live
 * site come up empty. Returns what the live site knows so Benny can correct
 * himself before saying no.
 */
export async function verifyBeforeSayingNo(query) {
  const liveResults = await searchLiveSite(query, 6);
  return {
    checkedLiveSite: true,
    foundOnLiveSite: liveResults.length > 0,
    liveResults
  };
}
