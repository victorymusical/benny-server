// bennyTools.js — the tools Benny can call himself.
//
// THE ARCHITECTURAL CHANGE:
//
//   Before: the server picked queries, capped results at 20, and handed Benny
//           a pile. Benny was a passenger. A passenger with a 20-item pile is
//           always dumber than a driver with a search box.
//
//   Now:    Benny gets a DOOR into all 5,244 products and opens it as often as
//           he likes, with whatever queries HE decides are right.
//
// This is why no cap is needed: he isn't handed a list, he queries the catalog.
// And it's why almost no rules are needed: he searches per-role naturally,
// because searching IS what designing a system looks like. We don't have to
// force him to design. He designs in order to know what to search for.

import {
  searchCatalog,
  findByVendor,
  listVendorsMatching,
  findByHandle,
  slim
} from "./catalogSearch.js";
import { searchLiveSite } from "./siteVerify.js";
import { getCatalogCount, getActiveCount, getDraftCount } from "./catalog.js";

/* ---------------- TOOL DEFINITIONS (sent to OpenAI) ---------------- */

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description:
        "Search Victory's real product catalog. Use this EVERY time you need a product. " +
        "Call it as many times as you need — once per role, per category, per brand. " +
        "Designing a church sound system? Search 'powered PA speaker', then 'live mixer', " +
        "then 'speaker stand', then 'vocal microphone', then 'XLR cable' — separate searches. " +
        "This is the ONLY way to find real products. Never name a product you haven't found here.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to search for. Use the words a product would actually be titled or typed with, " +
              "e.g. 'powered PA speaker', 'digital mixer 16 channel', 'dynamic vocal microphone', " +
              "'speaker stand', 'XLR cable', 'JBL loudspeaker'."
          },
          limit: {
            type: "integer",
            description: "How many results (default 10, max 40). Use more when comparing options."
          },
          sellable_only: {
            type: "boolean",
            description:
              "Default true. Set false to also see products we have in our system but cannot " +
              "sell today (drafts) — useful to tell a customer 'we may be able to source that'."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_by_brand",
      description:
        "Find products from a specific brand. Use when the customer names a brand, or to check " +
        "whether Victory actually carries a brand before you ever say we don't.",
      parameters: {
        type: "object",
        properties: {
          brand: { type: "string", description: "Brand name, e.g. 'HK Audio', 'JBL', 'Shure'." },
          limit: { type: "integer", description: "How many results (default 20)." }
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
        "Get the COMPLETE list of brands Victory carries in a category, counted from the real " +
        "catalog. Use this for 'what brands do you carry' questions. Never guess at a brand list.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "e.g. 'piano', 'microphone', 'speaker', 'guitar', 'drum'."
          }
        },
        required: ["category"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_product_by_handle",
      description:
        "Look up one exact product by its handle. Use when a customer pastes a victorymusical.com " +
        "product link — the handle is the last part of the URL.",
      parameters: {
        type: "object",
        properties: {
          handle: { type: "string", description: "e.g. 'vivace-pro'" }
        },
        required: ["handle"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_live_website",
      description:
        "Search the live victorymusical.com website directly. This is a SECOND OPINION. " +
        "You MUST call this before ever telling a customer you cannot find something. " +
        "The catalog can be out of date; the live site is the truth. Only after BOTH come up " +
        "empty may you say you're not seeing it.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Product or brand to look for on the live site." }
        },
        required: ["query"]
      }
    }
  }
];

/* ---------------- TOOL EXECUTION ---------------- */

export async function executeTool(name, args) {
  try {
    switch (name) {
      case "search_catalog": {
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 40);
        const sellableOnly = args.sellable_only !== false;
        const results = searchCatalog(args.query, {
          limit,
          includeDrafts: !sellableOnly
        }).map(slim);

        return {
          query: args.query,
          found: results.length,
          products: results,
          note: results.length === 0
            ? "No catalog match. Try different words, or call check_live_website before saying we don't have it."
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
            ? `No products found for "${args.brand}" in the catalog. Call check_live_website before saying we don't carry it.`
            : undefined
        };
      }

      case "list_brands_in_category": {
        const brands = listVendorsMatching(args.category, 40);
        return {
          category: args.category,
          brands,
          note: "'active' = sellable now. 'draft' = in our system but not sellable today. " +
                "This list is complete for the catalog, but never tell a customer a brand is the ONLY one we carry."
        };
      }

      case "get_product_by_handle": {
        const p = findByHandle(args.handle);
        return p
          ? { found: true, product: slim(p) }
          : { found: false, note: "Not in the catalog. Try check_live_website." };
      }

      case "check_live_website": {
        const results = await searchLiveSite(args.query, 8);
        return {
          query: args.query,
          found_on_live_site: results.length > 0,
          results,
          note: results.length > 0
            ? "These exist on the live site but weren't in the catalog — the catalog may be stale. " +
              "Acknowledge they exist and offer to connect the customer with the team to confirm."
            : "Neither the catalog nor the live site has this. You may now honestly say you're not " +
              "seeing it — but NEVER say 'we don't sell it', and NEVER refer them to another retailer."
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
