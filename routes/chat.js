import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { searchShopifyProducts } from "../services/shopify.js";
import { normalizeCategoryFromMessages } from "../services/category.js";
import { getVendorsForCategory } from "../services/vendors.js";

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

function getLastUserMessage(messages) {
  return messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";
}

function detectSearchQuery(messages, normalizedCategory) {
  const lastUserMessage = getLastUserMessage(messages).toLowerCase();

  if (lastUserMessage.includes("apollo")) return "Apollo audio interface";
  if (lastUserMessage.includes("universal audio")) return "Universal Audio audio interface";
  if (lastUserMessage.includes("ik multimedia")) return "IK Multimedia audio interface";
  if (lastUserMessage.includes("esi")) return "ESI audio interface";

  if (normalizedCategory) return normalizedCategory;

  const userText = messages
    .filter(m => m.role === "user")
    .map(m => String(m.content || "").toLowerCase())
    .join(" ");

  if (userText.includes("audio interface")) return "audio interface";
  if (userText.includes("sound card")) return "audio interface";
  if (userText.includes("recording interface")) return "audio interface";
  if (userText.includes("usb interface")) return "audio interface";
  if (userText.includes("microphone")) return "microphone";
  if (userText.includes("headphone")) return "headphones";
  if (userText.includes("saxophone") || userText.includes("sax")) return "saxophone";
  if (userText.includes("trumpet")) return "trumpet";
  if (userText.includes("trombone")) return "trombone";
  if (userText.includes("clarinet")) return "clarinet";
  if (userText.includes("flute")) return "flute";

  return getLastUserMessage(messages);
}

function detectBrandQuestion(messages) {
  const lastUserMessage = getLastUserMessage(messages).toLowerCase();

  return (
    lastUserMessage.includes("what brands") ||
    lastUserMessage.includes("which brands") ||
    lastUserMessage.includes("how many brands") ||
    lastUserMessage.includes("brands do you carry") ||
    lastUserMessage.includes("brands do you sell") ||
    lastUserMessage.includes("brands do you offer")
  );
}

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const salesKnowledge = loadKnowledgeFile("sales-methodology.md");
    const conversationalRules = loadKnowledgeFile("conversational-rules.md");
    const categoryGovernance = loadKnowledgeFile("category-governance.md");
    const greetingRules = loadKnowledgeFile("greeting-rules.md");

    const normalizedCategory = normalizeCategoryFromMessages(messages);
    const isBrandQuestion = detectBrandQuestion(messages);
    const searchQuery = detectSearchQuery(messages, normalizedCategory);

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

NORMALIZED CATEGORY:
${normalizedCategory || "None"}

SEARCH QUERY USED:
${searchQuery}

CUSTOMER IS ASKING ABOUT BRANDS:
${isBrandQuestion ? "YES" : "NO"}

CATEGORY VENDORS VERIFIED FROM FILTERED PRODUCT CATEGORY:
${JSON.stringify(categoryVendors, null, 2)}

PRODUCT SEARCH VENDORS:
${JSON.stringify(productSearchVendors, null, 2)}

REAL SHOPIFY PRODUCTS FOUND:
${JSON.stringify(products, null, 2)}

Core behavior:
- Keep responses concise and helpful
- Avoid filler conversation
- Act like a professional consultant, not a pushy salesperson
- Remember prior customer answers in the conversation
- Ask only one useful question at a time
- Never recommend products or brands outside VictoryMusical.com
- Never invent product names, brands, prices, specifications, or inventory
- If the customer asks what brands we carry, answer from CATEGORY VENDORS VERIFIED FROM FILTERED PRODUCT CATEGORY, not from generic product search
- Do not mention StreamPath as an audio interface brand unless it appears in CATEGORY VENDORS VERIFIED FROM FILTERED PRODUCT CATEGORY
- Do not say we do not carry a specific brand unless the product search specifically searched that brand and returned no relevant products
- If the customer asks for Apollo, treat Apollo as Universal Audio and search for Apollo audio interfaces
- If no relevant products or vendors are found, say you need to check availability instead of making absolute inventory claims
`
        },
        ...messages
      ]
    });

    res.json({
      reply: response.choices[0].message.content,
      normalizedCategory,
      searchQuery,
      isBrandQuestion,
      categoryVendors,
      productSearchVendors,
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
