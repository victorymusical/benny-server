import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { searchShopifyProducts, getCollectionProducts } from "../services/shopify.js";
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

// Always-on rules. Small and cheap. These set tone, policy, and safety.
const CORE_KNOWLEDGE = [
  "sales-methodology.md",
  "conversational-rules.md",
  "category-governance.md",
  "greeting-rules.md",
  "retrieval-safety-rules.md"
];

// Topic-specific docs. Loaded ONLY when the conversation is about that topic, so
// the right expertise drives the answer instead of being buried under everything.
const KNOWLEDGE_MAP = [
  { keywords: ["sax", "saxophone", "alto", "tenor", "soprano"], files: ["saxophones.md", "reed-instruments.md"] },
  { keywords: ["clarinet", "oboe", "bassoon", "reed"], files: ["reed-instruments.md"] },
  { keywords: ["flute", "piccolo"], files: ["flutes-piccolos.md"] },
  { keywords: ["trumpet", "cornet", "flugel"], files: ["high-brass.md"] },
  { keywords: ["trombone"], files: ["trombones.md", "low-brass.md"] },
  { keywords: ["euphonium", "baritone horn", "tuba", "sousaphone", "french horn"], files: ["low-brass.md"] },
  { keywords: ["bass guitar", "electric bass", "bassist"], files: ["bass-guitars.md"] },
  { keywords: ["guitar"], files: ["guitars.md"] },
  { keywords: ["keyboard", "piano", "synth", "workstation"], files: ["keys-and-synths.md"] },
  { keywords: ["drum"], files: ["drums.md"] },
  { keywords: ["percussion", "cymbal", "conga", "timbale", "marimba"], files: ["percussion.md"] },
  { keywords: ["violin", "viola", "cello", "orchestral string"], files: ["orchestral-strings.md"] },
  { keywords: ["microphone", " mic ", "wireless"], files: ["microphones.md"] },
  { keywords: ["interface", "apollo", "volt", "preamp"], files: ["audio-interfaces.md", "studio-workflows.md"] },
  { keywords: ["headphone", "studio monitor", "monitoring"], files: ["headphones-and-monitoring.md"] },
  { keywords: ["reverb", "effects", "bricasti", "outboard"], files: ["studio-workflows.md"] },
  { keywords: ["speaker", "pa system", "loudspeaker", "line array", "power amp", "amplifier", "mixer", "mixing", "live sound", "subwoofer", "wedge"], files: ["live-sound.md"] },
  { keywords: ["church", "worship", "sanctuary", "congregation", "house of worship"], files: ["house-of-worship.md", "live-sound.md"] },
  { keywords: ["stream", "ptz", "camera", "switcher", "atem", "broadcast", "video"], files: ["video-production.md", "broadcast-production.md"] },
  { keywords: ["dante", "network", "aes67", "avb"], files: ["network-solutions.md"] },
  { keywords: ["cable", "xlr", "trs", "hosa", "monster", "snake"], files: ["cables.md"] },
  { keywords: ["school", "band program", "orchestra program", "educator", "marching"], files: ["band-and-orchestra-programs.md"] }
];

const FINANCING_FILES = ["financing-rules.md", "financing-and-sales.md"];

function selectKnowledgeFiles(messages, intentData) {
  const conversationText = messages
    .filter(m => m.role === "user")
    .map(m => String(m.content || ""))
    .join(" ")
    .toLowerCase();

  const intentText = JSON.stringify(intentData || {}).toLowerCase();
  const haystack = ` ${conversationText} ${intentText} `;

  const files = new Set(CORE_KNOWLEDGE);

  for (const entry of KNOWLEDGE_MAP) {
    if (entry.keywords.some(k => haystack.includes(k))) {
      entry.files.forEach(f => files.add(f));
    }
  }

  const wantsFinancing =
    intentData?.needsFinancing ||
    intentData?.needsQuote ||
    intentData?.needsPrice ||
    ["financ", "payment", "monthly", "lease", "afterpay", "installment"].some(k =>
      haystack.includes(k)
    );

  if (wantsFinancing) FINANCING_FILES.forEach(f => files.add(f));

  return [...files];
}

function loadKnowledgeBase(messages, intentData) {
  return selectKnowledgeFiles(messages, intentData)
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
    const combinedProducts = [];

    // 1. If we know the real collection, pull from it first. This is the
    //    authoritative source for a category browse (e.g. real PA speakers),
    //    so we never substitute a desk monitor for a sanctuary speaker.
    if (queryGroup.collectionHandle) {
      const collectionProducts = await getCollectionProducts(queryGroup.collectionHandle, 30);
      combinedProducts.push(...collectionProducts);
    }

    // 2. Always also run the most specific text query, so a named brand or model
    //    surfaces even if it is not in the first page of the collection, and so
    //    categories without a collection still return results.
    const textQueries = [
      ...new Set(
        (queryGroup.searchQueries || [])
          .filter(Boolean)
          .map(q => String(q).trim())
          .filter(Boolean)
      )
    ];

    const queryBudget = queryGroup.collectionHandle ? 2 : 3;
    for (const query of textQueries.slice(0, queryBudget)) {
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
      products: dedupedProducts
    });
  }

  return productGroups;
}

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const intentData = await classifyIntentWithAI(messages);
    const knowledgeBase = loadKnowledgeBase(messages, intentData);

    const rawProductGroups = await getProductsForIntent(intentData);
    const validatedProductGroups = validateProductGroups(rawProductGroups);

    const products = flattenValidatedProducts(validatedProductGroups);
    const mainProducts = getMainProducts(validatedProductGroups);
    const accessories = getAccessories(validatedProductGroups);

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

RECOMMENDED PRODUCTS (already ranked best-first from live store collections and search. Recommend from THIS list):
${JSON.stringify(recommendedProducts, null, 2)}

BRANDS FOUND BY CATEGORY (use only to answer "what brands do you carry" style questions):
${JSON.stringify(categoryVendorResults, null, 2)}

YOUR TWO JOBS (read this carefully):
You have two different jobs, and they follow different rules.

JOB 1 - DESIGN AND EDUCATE (use your full expertise):
- Use everything you know about music gear, audio, and system design, together with
  the knowledge above, to work out what the customer actually needs. Think like a
  systems engineer here.
- For a room or venue, reason about the whole signal chain and the roles that must be
  filled: main speakers sized to the room, a subwoofer if needed, a mixer with enough
  channels, wireless for singers or pastors, stage monitors, cabling, stands, and
  power. Explain the plan in plain language.
- Describe these needs by ROLE and CAPABILITY, for example "a digital mixer with at
  least 16 channels" or "mains that can cover a 200-seat room". You may share general
  rules of thumb. Do NOT name specific commercial brands or models in this design part,
  because that can imply we stock them.

JOB 2 - FILL THE DESIGN WITH REAL PRODUCTS (locked to the catalog):
- Once the plan is clear, fill each role with a real item from RECOMMENDED PRODUCTS.
- Every specific product, price, spec figure, and availability you state MUST come from
  RECOMMENDED PRODUCTS. Never invent a product, a price, a spec number, or a stock
  status, and never claim Victory carries something unless it is in that list.
- For any role where RECOMMENDED PRODUCTS has no good fit, or only an undersized one,
  say so plainly and offer to have the Victory team spec and quote that piece. Do not
  quietly fill a role with the wrong-size item.

So: design freely from your knowledge, but every actual product must be real.

CONSULT BEFORE A BIG BUILD:
- If the customer wants a whole system or says things like "I need everything", ask one
  to three short scoping questions first, one at a time: how many seats or people, room
  size, whether they also live stream, and rough budget. Then design to that scale.

HOW TO ANSWER:
- Be concise, warm, and consultative. A guide, not a pushy salesperson.
- Ask only one question at a time, and remember earlier answers.
- Lead with the design or the direct answer, then fill with products.
- Items with matchLabel "accessory" are add-ons, not the main item, unless asked for.

FIT AND HONESTY:
- Never assume a category is unavailable. Rely on RECOMMENDED PRODUCTS, and remember the
  team can source things that are not showing.
- Present undersized or imperfect matches honestly and offer the handoff for the right spec.
- If nothing fits, say you are not seeing the right match clearly right now and offer the
  team handoff. Never say Victory does not carry it.

HOW TO SHOW PRODUCTS (the page draws the cards for you):
- Do NOT paste URLs, links, or "Add to cart:" text. The page renders a product card with
  image, price, sale badge, and Add to Cart button automatically.
- When you recommend a real product, write one short sentence about it, then place a
  marker on its OWN line right after, exactly: [[PRODUCT:handle]] using the product's
  "handle" from RECOMMENDED PRODUCTS. Example: [[PRODUCT:jbl-3-way-powered-loudspeaker]]
- One marker per product, only for products in RECOMMENDED PRODUCTS. Name the product in
  your sentence; do not write the price yourself.

THE BENNY MODEL:
- Help the customer explore, learn, design, compare, and build a cart or full system.
- You can assemble a multi-item cart or quote and summarize it, but never claim a real
  order has been placed.
- When they are ready, invite them to confirm final availability, pricing, and details
  with a Victory team member during business hours. Frame it as the natural next step,
  not as you being unable to help. Do not overpromise.
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
