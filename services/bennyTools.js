// bennyTools.js
//
// THE CORE FIX:
//
// Benny must COMMIT to what the customer needs BEFORE he is allowed to see
// what's available.
//
// Every failure we've had is the same bug: he searches, gets a list, and the
// list becomes the answer. He selects from a menu instead of deciding what's
// needed. That's how a church asking for a "mixer" got a video switcher, and
// how "vocal microphone" would get a USB podcast condenser.
//
// So search_catalog now REQUIRES a `spec` — Benny must state what he's actually
// looking for and why, in his own words, before the tool returns anything.
// Once he's written "handheld dynamic cardioid mic for live worship vocals,"
// the USB condenser can't win — he already decided what he was looking for.
//
// This doesn't limit his intelligence. It's what forces him to USE it.

import {
  searchCatalog,
  findByVendor,
  listVendorsMatching,
  findByHandle,
  slim
} from "./catalogSearch.js";
import { searchLiveSite } from "./siteVerify.js";
import { getCatalogCount, getActiveCount, getDraftCount } from "./catalog.js";

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description:
        "Search Victory's real catalog. The ONLY way to find products you can sell.\n\n" +
        "TWO SEPARATE FIELDS — DO NOT CONFUSE THEM:\n\n" +
        "`query` = SEARCH BROAD. Use ONLY the product noun and the instrument. This is matched " +
        "against product TITLES and TYPES. Keep it simple.\n" +
        "`spec` = JUDGE NARROW. What the customer actually needs. Used by YOU to evaluate the " +
        "results afterwards. NEVER put spec details into the query.\n\n" +
        "*** CRITICAL: attributes like reed STRENGTH (soft/2.5/hard), sax FINISH (gold/silver), " +
        "cable LENGTH, or drumhead SIZE are VARIANT OPTIONS. They are NOT in product titles. " +
        "Searching for them returns NOTHING and makes you wrongly tell a customer we don't " +
        "carry it. Search for the PRODUCT, then read its `options` and `variants` to find the " +
        "strength/size/finish. ***\n\n" +
        "RIGHT:\n" +
        "  Customer: 'soft alto sax reeds'\n" +
        "  query: 'alto saxophone reed'   <-- broad, matches titles\n" +
        "  spec: 'Alto sax reed, soft strength (around 2 or 2.5). Check variant options for strength.'\n\n" +
        "WRONG (this is the bug that lost a sale):\n" +
        "  query: 'soft alto saxophone reed'   <-- the word 'soft' is in no title. Returns 0.\n\n" +
        "MORE EXAMPLES:\n" +
        "  'vocal mic for church' -> query: 'vocal microphone' | spec: 'Handheld dynamic cardioid " +
        "for live worship. Rejects room noise and wedges. NOT a USB podcast mic, NOT a studio condenser.'\n" +
        "  'mixer for church' -> query: 'mixer' | spec: 'Live-sound audio mixing console for mics " +
        "and instruments into a PA. NOT a video switcher, NOT a studio recording interface.'\n\n" +
        "If the first query returns nothing, TRY A BROADER ONE before concluding anything. " +
        "'alto saxophone reed' -> 'saxophone reed' -> 'reed'. Never give up after one search.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "BROAD. Product noun + instrument only. Words that appear in a TITLE. " +
              "*** ALWAYS IN ENGLISH — the catalog's titles and types are English. If the " +
              "conversation is in Spanish or any other language, TRANSLATE the need into an " +
              "English query ('microfono para saxofon alto' -> 'alto saxophone wireless " +
              "microphone'). A non-English query returns nothing and makes you wrongly tell " +
              "the customer we have nothing. *** " +
              "e.g. 'alto saxophone reed', 'vocal microphone', 'powered PA speaker'. " +
              "NEVER include strength, size, finish, or color — those are variant options."
          },
          spec: {
            type: "string",
            description:
              "NARROW. What the customer actually needs, and what would NOT qualify. " +
              "You use this to judge results. It does NOT affect the search."
          },
          limit: { type: "integer", description: "Results (default 12, max 40)." },
          sellable_only: {
            type: "boolean",
            description: "Default true. False also shows drafts we can't sell today."
          }
        },
        required: ["query", "spec"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_by_brand",
      description:
        "Find products from a brand. Use when the customer names one, or to check whether Victory " +
        "carries a brand before you ever suggest we don't.",
      parameters: {
        type: "object",
        properties: {
          brand: { type: "string" },
          limit: { type: "integer" }
        },
        required: ["brand"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_brands_in_category",
      description:
        "Complete list of brands Victory carries in a category, counted from the real catalog. " +
        "Use for 'what brands do you carry'. Never guess a brand list.",
      parameters: {
        type: "object",
        properties: { category: { type: "string" } },
        required: ["category"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_product_by_handle",
      description: "Look up one exact product by handle. Use when a customer pastes a product link.",
      parameters: {
        type: "object",
        properties: { handle: { type: "string" } },
        required: ["handle"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_live_website",
      description:
        "Search the live victorymusical.com site. INFORMATION ONLY — results from this tool can " +
        "NEVER be sold, priced, or put in a cart. Use it before telling a customer you can't find " +
        "something, in case the catalog is stale. If it finds something, say the team will confirm " +
        "availability and fit — do not offer to sell it.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"]
      }
    }
  }
];

export async function executeTool(name, args) {
  try {
    switch (name) {
      case "search_catalog": {
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 40);
        const sellableOnly = args.sellable_only !== false;
        const results = searchCatalog(args.query, {
          limit,
          includeDrafts: !sellableOnly
        }).map(slim);

        const withOptions = results.filter(p => p.hasVariants).length;

        // Brand distribution — AWARENESS, not a cap. Nothing is hidden; Benny
        // simply SEES the range so one keyword-rich brand can't feel like the
        // whole store.
        const brandCounts = {};
        for (const p of results) {
          if (p.vendor) brandCounts[p.vendor] = (brandCounts[p.vendor] || 0) + 1;
        }

        return {
          your_spec: args.spec,
          query_used: args.query,
          found: results.length,
          brands_in_these_results: brandCounts,
          products: results,
          HOW_TO_USE_THIS: [
            "These matched WORDS in titles/types. They are CANDIDATES, not answers.",
            "Judge each against YOUR spec above. Reject anything that doesn't fit.",
            "Check brands_in_these_results: if one brand dominates, that reflects title " +
              "wording, not our range. Consider showing the customer more than one brand, " +
              "and offer to look at other brands.",
            "NEVER offer the wrong instrument. If they asked for ALTO, a BARITONE reed is WRONG — " +
              "it is not 'suitable', it is a different instrument. Do not substitute.",
            "NEVER offer the wrong BRAND. If the customer asked for Hosa, do not say 'yes we carry " +
              "Hosa' and then show an On-Stage product. The product you show MUST be the brand they " +
              "asked for. If you don't find that brand, search again with search_by_brand. If it's " +
              "genuinely not there, say you're not seeing it — do NOT quietly swap in another brand.",
            "NEVER offer the wrong PRODUCT CATEGORY. A lavalier mic is not a wireless system. " +
              "A studio interface is not a mixing console. Read the productType.",
            withOptions > 0
              ? "IMPORTANT: some of these have `options` and `variants`. Strength, size, finish, " +
                "and length live THERE, not in the title. If the customer asked for a 'soft' reed " +
                "or a 'silver' finish, look in the variants — do NOT say we don't carry it."
              : null,
            results.length === 0
              ? "Nothing found. TRY A BROADER QUERY before concluding anything ('alto saxophone " +
                "reed' -> 'saxophone reed' -> 'reed'). Only after several honest attempts should " +
                "you call check_live_website."
              : null
          ].filter(Boolean)
        };
      }

      case "search_by_brand": {
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 40);
        const results = findByVendor(args.brand, limit).map(slim);
        return {
          brand: args.brand,
          found: results.length,
          products: results,
          note: results.length === 0
            ? `No catalog products for "${args.brand}". Call check_live_website before saying we don't carry it.`
            : undefined
        };
      }

      case "list_brands_in_category": {
        return {
          category: args.category,
          brands: listVendorsMatching(args.category, 40),
          note: "'active' = sellable. 'draft' = in our system, not sellable today. " +
                "Never tell a customer a brand is the ONLY one we carry."
        };
      }

      case "get_product_by_handle": {
        const p = findByHandle(args.handle);
        return p
          ? { found: true, product: slim(p) }
          : { found: false, note: "Not in catalog. Try check_live_website." };
      }

      case "check_live_website": {
        const results = await searchLiveSite(args.query, 8);
        return {
          query: args.query,
          found_on_live_site: results.length > 0,
          // Deliberately NOT called "products" — these can never become cards.
          live_site_results: results,
          CRITICAL:
            "INFORMATION ONLY. These are NOT sellable products. You may NOT put these in your " +
            "products list, quote their prices, or offer a cart for them. They have not been " +
            "verified for stock, price, or fit.",
          what_to_say: results.length > 0
            ? "Acknowledge you're seeing something similar on the site, and that the team will " +
              "confirm the exact fit and availability. Do NOT sell it."
            : "Neither the catalog nor the live site has this. You may now say you're not seeing " +
              "it — but NEVER say 'we don't sell it', and NEVER refer them to another retailer."
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    console.error(`Tool ${name} failed:`, error.message);
    return { error: error.message };
  }
}

export function getCatalogStats() {
  return {
    total: getCatalogCount(),
    sellable: getActiveCount(),
    not_yet_available: getDraftCount()
  };
}
