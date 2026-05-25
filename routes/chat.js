import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { searchShopifyProducts } from "../services/shopify.js";
import { getVendorsForCategory } from "../services/vendors.js";
import { classifyIntentWithAI } from "../services/intentAI.js";
import { buildTaxonomySearchQueries } from "../services/taxonomy.js";
import {
  validateProductGroups,
  flattenValidatedProducts,
  getMainProducts,
  getAccessories
} from "../services/productValidation.js";

const router = express.Router();

function loadKnowledgeFile(filename) {
  const filePath = path.join(process.cwd(), "knowledge", filename);

  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.warn(`Knowledge file missing: ${filename}`);
    return "";
  }
}

function loadKnowledgeBase() {
  const knowledgeFiles = [
    "sales-methodology.md",
    "conversational-rules.md",
    "category-governance.md",
    "greeting-rules.md",
    "retrieval-safety-rules.md",
    "financing-rules.md",
    "financing-and-sales.md",

    "saxophones.md",
    "reed-instruments.md",
    "flutes-piccolos.md",
    "high-brass.md",
    "low-brass.md",
    "trombones.md",

    "guitars.md",
    "bass-guitars.md",
    "keys-and-synths.md",

    "drums.md",
    "percussion.md",
    "orchestral-strings.md",

    "audio-interfaces.md",
    "microphones.md",
    "headphones-and-monitoring.md",
    "studio-workflows.md",
    "video-production.md",
    "live-sound.md",
    "network-solutions.md",
    "house-of-worship.md",
    "cables.md"
  ];

  return knowledgeFiles
    .map(file => {
      const content = loadKnowledgeFile(file);

      return content
        ? `\n\n===== ${file} =====\n\n${content}`
        : "";
    })
    .join("\n");
}

async function getProductsForIntent(intentData) {
  const productGroups = [];
  const taxonomyQueries = buildTaxonomySearchQueries(intentData);

  for (const queryGroup of taxonomyQueries) {
    const uniqueQueries = [
      ...new Set(
        (queryGroup.searchQueries || [])
          .filter(Boolean)
          .map(query => String(query).trim())
          .filter(Boolean)
      )
    ];

    const combinedProducts = [];

    for (const query of uniqueQueries.slice(0, 4)) {
      const products = await searchShopifyProducts(query, 10);
      combinedProducts.push(...products);
    }

    const dedupedProducts = [
      ...new Map(
        combinedProducts.map(product => [product.handle, product])
      ).values()
    ];

    productGroups.push({
      requestedItem: queryGroup.requestedItem,
      taxonomyCategory: queryGroup.taxonomyCategory,
      collectionHandle: queryGroup.collectionHandle,
      searchQueriesUsed: uniqueQueries.slice(0, 4),
      products: dedupedProducts
    });
  }

  return productGroups;
}

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const knowledgeBase = loadKnowledgeBase();

    const intentData = await classifyIntentWithAI(messages);

    const rawProductGroups = await getProductsForIntent(intentData);
    const validatedProductGroups = validateProductGroups(rawProductGroups);

    const products = flattenValidatedProducts(validatedProductGroups);
    const mainProducts = getMainProducts(validatedProductGroups);
    const accessories = getAccessories(validatedProductGroups);

    const categories = [
      ...new Set(
        (intentData.requestedItems || [])
          .map(item => item.category)
          .filter(Boolean)
      )
    ];

    const categoryVendorResults = [];

    for (const category of categories) {
      const vendors = await getVendorsForCategory(category);

      categoryVendorResults.push({
        category,
        vendors
      });
    }

    const productSearchVendors = [
      ...new Set(
        products
          .map(p => p.vendor)
          .filter(Boolean)
          .map(v => v.trim())
      )
    ].sort();

    const saleProducts = products.filter(product => product.isOnSale);

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
You are Benny, a consultative AI sales advisor for Victory Musical Instruments.

Use the following internal knowledge carefully:

${knowledgeBase}

INTENT DATA:
${JSON.stringify(intentData, null, 2)}

RAW SHOPIFY PRODUCT GROUPS FOUND:
${JSON.stringify(rawProductGroups, null, 2)}

VALIDATED PRODUCT GROUPS:
${JSON.stringify(validatedProductGroups, null, 2)}

ALL VALIDATED PRODUCTS:
${JSON.stringify(products, null, 2)}

MAIN PRODUCTS ONLY:
${JSON.stringify(mainProducts, null, 2)}

ACCESSORIES FOUND:
${JSON.stringify(accessories, null, 2)}

CATEGORY VENDOR RESULTS:
${JSON.stringify(categoryVendorResults, null, 2)}

PRODUCT SEARCH VENDORS:
${JSON.stringify(productSearchVendors, null, 2)}

SALE PRODUCTS FOUND:
${JSON.stringify(saleProducts, null, 2)}

Core behavior:
- Keep responses concise and helpful.
- Act like a professional consultant, not a pushy salesperson.
- Remember prior customer answers in the conversation.
- Ask only one useful question at a time.
- Never recommend products or brands outside VictoryMusical.com unless discussing special-order or quote-based consultation.
- Never invent product names, brands, prices, specifications, discounts, or inventory.
- Prefer MAIN PRODUCTS ONLY when the customer asks for a main product or instrument.
- Do not present accessories as main products unless the customer specifically asks for accessories.
- If product data is available, answer directly from validated product data.
- If the customer asks for price, discount, sale, availability, or link, answer directly from product data.
- You are allowed to provide product URLs from Shopify product data.
- When an addToCartUrl is available, include it as an Add to Cart link.
- Never say you cannot provide links if a product URL is available.
- Never tell the customer to wait while you check.
- If a product has isOnSale=true, explain that it is currently showing sale pricing.
- If compareAtPrice is higher than price, explain the current price and original compare-at price.
- If the customer asks what brands we carry, answer from CATEGORY VENDOR RESULTS when available.
- Do not make absolute inventory claims from partial search results.
- Failed product search does not mean unavailable.
- Do not say Victory does not carry a product unless retrieval and validation strongly support that answer.
- If retrieval is weak, say you are not seeing it clearly and recommend direct confirmation.
- If no relevant products or vendors are found, use honest uncertainty instead of making absolute claims.
- If the customer is building a quote, summarize the requested items clearly but do not claim that a real cart or order has been created yet.
- When the customer gives multiple products, treat it as a multi-item quote or cart-building request.
`
        },
        ...messages
      ]
    });

    res.json({
      reply: response.choices[0].message.content,
      intentData,
      rawProductGroups,
      validatedProductGroups,
      products,
      mainProducts,
      accessories,
      categoryVendorResults,
      productSearchVendors,
      saleProducts
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Benny encountered an error.",
      details: error.message
    });
  }
});

export default router;
