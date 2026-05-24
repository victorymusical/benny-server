import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { searchShopifyProducts } from "../services/shopify.js";
import { normalizeCategoryFromMessages } from "../services/category.js";

const router = express.Router();
const greetingRules = loadKnowledgeFile("greeting-rules.md");

function loadKnowledgeFile(filename) {
  const filePath = path.join(process.cwd(), "knowledge", filename);

  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.warn(`Knowledge file missing: ${filename}`);
    return "";
  }
}

function detectSearchQuery(messages) {
  const userText = messages
    .filter(m => m.role === "user")
    .map(m => String(m.content || "").toLowerCase())
    .join(" ");

  if (userText.includes("audio interface")) return "audio interface";
  if (userText.includes("microphone")) return "microphone";
  if (userText.includes("headphone")) return "headphones";
  if (userText.includes("saxophone") || userText.includes("sax")) return "saxophone";
  if (userText.includes("trumpet")) return "trumpet";
  if (userText.includes("trombone")) return "trombone";
  if (userText.includes("clarinet")) return "clarinet";
  if (userText.includes("flute")) return "flute";

  const lastUserMessage =
    messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";

  return lastUserMessage;
}

function detectBrandQuestion(messages) {
  const lastUserMessage =
    messages.filter(m => m.role === "user").slice(-1)[0]?.content?.toLowerCase() || "";

  return (
    lastUserMessage.includes("what brands") ||
    lastUserMessage.includes("which brands") ||
    lastUserMessage.includes("brands do you carry") ||
    lastUserMessage.includes("brands do you sell")
  );
}

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const salesKnowledge = loadKnowledgeFile("sales-methodology.md");
    const conversationalRules = loadKnowledgeFile("conversational-rules.md");
    const categoryGovernance = loadKnowledgeFile("category-governance.md");

    const normalizedCategory = normalizeCategoryFromMessages(messages);
    const fallbackSearchQuery = detectSearchQuery(messages);
    const searchQuery = normalizedCategory || fallbackSearchQuery;
    const isBrandQuestion = detectBrandQuestion(messages);

    let products = [];

    if (searchQuery) {
      products = await searchShopifyProducts(searchQuery, 10);
    }

    const brands = [
      ...new Set(
        products
          .map(p => p.vendor)
          .filter(Boolean)
      )
    ];

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

GREETING RULES:
${greetingRules}

CATEGORY GOVERNANCE:
${categoryGovernance}

NORMALIZED CATEGORY:
${normalizedCategory || "None"}

SEARCH QUERY USED:
${searchQuery}

REAL SHOPIFY PRODUCTS FOUND:
${JSON.stringify(products, null, 2)}

BRANDS FOUND FROM SHOPIFY PRODUCTS:
${JSON.stringify(brands, null, 2)}

CUSTOMER IS ASKING ABOUT BRANDS:
${isBrandQuestion ? "YES" : "NO"}

Core behavior:
- Keep responses concise and helpful
- Avoid filler conversation
- Act like a professional consultant, not a pushy salesperson
- Remember prior customer answers in the conversation
- Ask only one useful question at a time
- Never recommend products or brands outside VictoryMusical.com
- Never invent product names, brands, prices, specifications, or inventory
- Only recommend products from REAL SHOPIFY PRODUCTS FOUND
- If the customer asks what brands we carry, answer directly using BRANDS FOUND FROM SHOPIFY PRODUCTS
- If no relevant brands or products are found, do not make absolute inventory claims. Ask one better qualifying question or say that you need to check availability.
`
        },
        ...messages
      ]
    });

    res.json({
      reply: response.choices[0].message.content,
      normalizedCategory,
      searchQuery,
      brands,
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
