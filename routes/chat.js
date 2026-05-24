import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { searchShopifyProducts } from "../services/shopify.js";
import { normalizeCategoryFromMessages } from "../services/category.js";
import { getVendorsForCategory } from "../services/vendors.js";
import { classifyIntent } from "../services/intent.js";

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

function buildSearchQuery(intentData, normalizedCategory) {
  const parts = [];

  if (intentData.specificProductMentioned) {
    parts.push(intentData.specificProductMentioned);
  }

  if (intentData.brandMentioned) {
    parts.push(intentData.brandMentioned);
  }

  if (intentData.categoryMentioned) {
    parts.push(intentData.categoryMentioned);
  }

  if (parts.length > 0) {
    return parts.join(" ");
  }

  if (normalizedCategory) {
    return normalizedCategory;
  }

  return intentData.lastUserMessage || "";
}

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const salesKnowledge = loadKnowledgeFile("sales-methodology.md");
    const conversationalRules = loadKnowledgeFile("conversational-rules.md");
    const categoryGovernance = loadKnowledgeFile("category-governance.md");
    const greetingRules = loadKnowledgeFile("greeting-rules.md");

    const intentData = classifyIntent(messages);
    const normalizedCategory =
      intentData.categoryMentioned || normalizeCategoryFromMessages(messages);

    const searchQuery = buildSearchQuery(intentData, normalizedCategory);

    let products = [];
    let categoryVendors = [];

    if (searchQuery) {
      products = await searchShopifyProducts(searchQuery, 20);
    }

    if (normalizedCategory) {
      categoryVendors = await getVendorsForCategory(normalizedCategory);
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
      messages: [
        {
          role: "system",
          content: `
You are Benny, a consultative AI advisor for Victory Musical Instruments.

Follow this internal knowledge carefully.

SALES METHODOLOGY:
${salesKnowledge}

CONVERSATIONAL RULES:
${conversationalRules}

CATEGORY GOVERNANCE:
${categoryGovernance}

GREETING RULES:
${greetingRules}

INTENT DATA:
${JSON.stringify(intentData, null, 2)}

NORMALIZED CATEGORY:
${normalizedCategory || "None"}

SEARCH QUERY USED:
${searchQuery}

CATEGORY VENDORS VERIFIED:
${JSON.stringify(categoryVendors, null, 2)}

PRODUCT SEARCH VENDORS:
${JSON.stringify(productSearchVendors, null, 2)}

REAL SHOPIFY PRODUCTS FOUND:
${JSON.stringify(products, null, 2)}

SALE PRODUCTS FOUND:
${JSON.stringify(saleProducts, null, 2)}

Core behavior:
- Keep responses concise and helpful
- Avoid filler conversation
- Act like a professional consultant, not a pushy salesperson
- Remember prior customer answers in the conversation
- Ask only one useful question at a time
- Never recommend products or brands outside VictoryMusical.com
- Never invent product names, brands, prices, specifications, discounts, or inventory
- If product data is available, answer directly from REAL SHOPIFY PRODUCTS FOUND
- If the customer asks for price, discount, sale, availability, or link, answer directly from product data
- You are allowed to provide product URLs from Shopify product data
- Never say you cannot provide links if a product URL is available
- Never tell the customer to wait while you check
- If a product has isOnSale=true, explain that it is currently showing sale pricing
- If compareAtPrice is higher than price, explain the current price and original compare-at price
- If the customer asks what brands we carry, answer from CATEGORY VENDORS VERIFIED when available
- Do not make absolute inventory claims from partial search results
- Do not say we do not carry a brand unless the search was specific to that brand and returned no relevant products
- If no relevant products or vendors are found, say you need to check availability instead of making absolute claims
- If the customer is building a quote, summarize the quote clearly but do not claim that a real cart or order has been created yet
`
        },
        ...messages
      ]
    });

    res.json({
      reply: response.choices[0].message.content,
      intentData,
      normalizedCategory,
      searchQuery,
      categoryVendors,
      productSearchVendors,
      saleProducts,
      products
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
