import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { searchShopifyProducts } from "../services/shopify.js";
import { getVendorsForCategory } from "../services/vendors.js";
import { classifyIntentWithAI } from "../services/intentAI.js";

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

async function getProductsForIntent(intentData) {
  const allProducts = [];

  if (!intentData.requestedItems || intentData.requestedItems.length === 0) {
    return allProducts;
  }

  for (const item of intentData.requestedItems) {
    const query =
      item.searchQuery ||
      [item.brand, item.product, item.category].filter(Boolean).join(" ");

    if (!query) continue;

    const products = await searchShopifyProducts(query, 10);

    allProducts.push({
      requestedItem: item,
      searchQuery: query,
      products
    });
  }

  return allProducts;
}

function flattenProducts(productGroups) {
  return productGroups.flatMap(group => group.products || []);
}

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const salesKnowledge = loadKnowledgeFile("sales-methodology.md");
    const conversationalRules = loadKnowledgeFile("conversational-rules.md");
    const categoryGovernance = loadKnowledgeFile("category-governance.md");
    const greetingRules = loadKnowledgeFile("greeting-rules.md");
    const financingRules = loadKnowledgeFile("financing-rules.md");

    const intentData = await classifyIntentWithAI(messages);

    const productGroups = await getProductsForIntent(intentData);
    const products = flattenProducts(productGroups);

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

Follow this internal knowledge carefully.

SALES METHODOLOGY:
${salesKnowledge}

CONVERSATIONAL RULES:
${conversationalRules}

CATEGORY GOVERNANCE:
${categoryGovernance}

GREETING RULES:
${greetingRules}

FINANCING AND PAYMENT RULES:
${financingRules}

INTENT DATA:
${JSON.stringify(intentData, null, 2)}

SHOPIFY PRODUCT GROUPS FOUND:
${JSON.stringify(productGroups, null, 2)}

ALL REAL SHOPIFY PRODUCTS FOUND:
${JSON.stringify(products, null, 2)}

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
- Never recommend products or brands outside VictoryMusical.com.
- Never invent product names, brands, prices, specifications, discounts, or inventory.
- If product data is available, answer directly from ALL REAL SHOPIFY PRODUCTS FOUND.
- If the customer asks for price, discount, sale, availability, or link, answer directly from product data.
- You are allowed to provide product URLs from Shopify product data.
- Never say you cannot provide links if a product URL is available.
- Never tell the customer to wait while you check.
- If a product has isOnSale=true, explain that it is currently showing sale pricing.
- If compareAtPrice is higher than price, explain the current price and original compare-at price.
- If the customer asks what brands we carry, answer from CATEGORY VENDOR RESULTS when available.
- Do not make absolute inventory claims from partial search results.
- Do not say we do not carry a brand unless the search was specific to that brand and returned no relevant products.
- If no relevant products or vendors are found, say you need to confirm availability instead of making absolute claims.
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
      productGroups,
      products,
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
