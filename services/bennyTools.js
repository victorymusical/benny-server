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
        "Search Victory's real catalog. This is the ONLY way to find products you can sell.\n\n" +
        "BEFORE you search, you must decide what the customer actually NEEDS — not just what " +
        "word they used. Fill in `spec` with the real requirement, in your own words, as a " +
        "working audio professional would state it.\n\n" +
        "Examples of thinking BEFORE searching:\n" +
        "  Customer says 'vocal mic for church' → spec: 'Handheld dynamic cardioid mic for live " +
        "worship vocals. Must reject room noise and stage wedges. NOT a USB podcast mic, NOT a " +
        "studio condenser.'\n" +
        "  Customer says 'mixer for church' → spec: 'Live-sound audio mixing console for mics and " +
        "instruments feeding a PA. NOT a video switcher, NOT a studio recording interface.'\n" +
        "  Customer says 'speakers for 200 seats' → spec: 'Powered full-range PA loudspeakers " +
        "sized for a 200-seat room. NOT desktop studio monitors.'\n\n" +
        "Then judge the results against your own spec. Anything that doesn't meet it, reject.",
      parameters: {
        type: "object",
        properties: {
          spec: {
            type: "string",
            description:
              "REQUIRED. What the customer actually needs, and explicitly what would NOT qualify. " +
              "Write this BEFORE you look at any products. This is your commitment."
          },
          query: {
            type: "string",
            description: "Search words likely to appear in a product's title or type."
          },
          limit: { type: "integer", description: "Results to return (default 12, max 40)." },
          sellable_only: {
            type: "boolean",
            description: "Default true. False also shows products we can't sell today (drafts)."
          }
        },
        required: ["spec", "query"]
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
        const limit = Math.min(Math.max(Number(args.limit) || 12, 1), 40);
        const sellableOnly = args.sellable_only !== false;
        const results = searchCatalog(args.query, {
          limit,
          includeDrafts: !sellableOnly
        }).map(slim);

        return {
          your_spec: args.spec,
          query: args.query,
          found: results.length,
          products: results,
          REMINDER:
            "These matched WORDS, not your spec. Read your own spec above and reject anything " +
            "that doesn't meet it. A product being in this list does NOT mean it's right. " +
            "If nothing here genuinely meets your spec, recommend NOTHING and hand this role to " +
            "the Victory team.",
          note: results.length === 0
            ? "Nothing found. Call check_live_website before saying we don't have it."
            : undefined
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
