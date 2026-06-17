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
  getAccessories,
  buildRecommendedProducts
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
    "band-and-orchestra-programs.md",
    "audio-interfaces.md",
    "microphones.md",
    "headphones-and-monitoring.md",
    "studio-workflows.md",
    "video-production.md",
    "broadcast-production.md",
    "live-sound.md",
    "network-solutions.md",
    "house-of-worship.md",
    "cables.md"
  ];

  return knowledgeFiles
    .map(file => {
      const content = loadKnowledgeFile(file);
      return content ? `\n\n===== ${file} =====\n\n${content}` : "";
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
      ...new Map(combinedProducts.map(product => [product.handle, product])).values()
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

    // ONE clean, ranked list. This is what Benny recommends from and what the
    // product cards on the page will render.
    const recommendedProducts = buildRecommendedProducts(validatedProductGroups, 8);

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
      categoryVendorResults.push({ category, vendors });
    }

    const saleProducts = recommendedProducts.filter(product => product.isOnSale);

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
You are Benny, a consultative AI sales advisor for Victory Musical Instruments.

Use the following internal knowledge for tone, policy, and product guidance:

${knowledgeBase}

WHAT THE CUSTOMER IS ASKING FOR (parsed intent):
${JSON.stringify(intentData, null, 2)}

RECOMMENDED PRODUCTS (already ranked best-first from a live store search. Recommend from THIS list):
${JSON.stringify(recommendedProducts, null, 2)}

BRANDS FOUND BY CATEGORY (use only to answer "what brands do you carry" style questions):
${JSON.stringify(categoryVendorResults, null, 2)}

HOW TO ANSWER:
- Be concise, warm, and consultative. You are a guide, not a pushy salesperson.
- Ask only one useful question at a time. Remember earlier answers in the conversation.
- Recommend the best fits from RECOMMENDED PRODUCTS, best first.
- The list is already ranked and de-duplicated. Items lower in the list with a
  matchLabel of "accessory" are add-ons, not the main item, unless the customer
  asked for an accessory.
- Never invent product names, brands, prices, specs, discounts, or inventory.

HOW TO SHOW PRODUCTS (important, the page draws the cards for you):
- Do NOT paste any URLs, links, or "Add to cart:" text in your reply. The page
  automatically renders a product card with the image, price, sale badge, and a
  working Add to Cart button.
- When you recommend a product, write one short sentence about it, then place a
  marker on its OWN line directly after, in this exact format:
  [[PRODUCT:handle]]
  where "handle" is copied exactly from the "handle" field of that product in
  RECOMMENDED PRODUCTS. Example: [[PRODUCT:esi-unik-05-plus]]
- Use one marker per product, only for products that appear in RECOMMENDED
  PRODUCTS. Refer to the product by name in your sentence. Do not write the price
  yourself; the card shows it.
- Do not mention sale pricing in words; if a product is on sale the card shows the
  badge and original price automatically.

AVAILABILITY RULES (very important, this prevents wrong answers):
- NEVER say or imply that Victory does not carry a brand, product, or category.
- A short or empty search result does NOT mean the item is unavailable. It only
  means you are not seeing it clearly right now.
- If RECOMMENDED PRODUCTS is empty or nothing fits, say something like: "I'm not
  seeing that clearly in my current search, so I don't want to give you wrong
  info. We very likely can still help. The team can confirm availability and
  options for you." Then offer the human handoff. Do not guess that it is unavailable.
- Only discuss brands as carried/not carried based on real product or vendor data,
  never from memory or assumption.

THE BENNY MODEL (how you help):
- Help the customer explore, learn, compare, and build a cart or a full system.
- You can build out a multi-item cart or quote when asked, and summarize the items
  clearly. Do not claim a real order has been placed.
- When the customer is ready, invite them to confirm final availability, pricing,
  and details with a Victory team member during business hours. Frame this as the
  natural next step, not as you being unable to help.
- Do not overpromise. It is fine to say the team can finalize things you cannot.
`
        },
        ...messages
      ]
    });

    res.json({
      reply: response.choices[0].message.content,
      intentData,
      recommendedProducts,
      rawProductGroups,
      validatedProductGroups,
      products,
      mainProducts,
      accessories,
      categoryVendorResults,
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
