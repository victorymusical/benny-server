import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { classifyIntentWithAI } from "../services/intentAI.js";
import {
  searchCatalog,
  findByVendor,
  listVendorsMatching,
  findByHandle,
  extractHandlesFromText,
  slim
} from "../services/catalogSearch.js";
import { verifyBeforeSayingNo } from "../services/siteVerify.js";
import { getCatalogCount, getActiveCount, getDraftCount } from "../services/catalog.js";

const router = express.Router();

/* ---------------- KNOWLEDGE (loaded by topic, not all at once) ---------------- */

function loadKnowledgeFile(filename) {
  try {
    return fs.readFileSync(path.join(process.cwd(), "knowledge", filename), "utf8");
  } catch {
    return "";
  }
}

const CORE_KNOWLEDGE = [
  "sales-methodology.md",
  "conversational-rules.md",
  "greeting-rules.md",
  "retrieval-safety-rules.md"
];

const KNOWLEDGE_MAP = [
  { keys: ["sax", "saxophone"], files: ["saxophones.md", "reed-instruments.md"] },
  { keys: ["clarinet", "oboe", "bassoon", "reed"], files: ["reed-instruments.md"] },
  { keys: ["flute", "piccolo"], files: ["flutes-piccolos.md"] },
  { keys: ["trumpet", "cornet", "flugel"], files: ["high-brass.md"] },
  { keys: ["trombone"], files: ["trombones.md", "low-brass.md"] },
  { keys: ["euphonium", "tuba", "french horn", "baritone horn"], files: ["low-brass.md"] },
  { keys: ["bass guitar", "electric bass"], files: ["bass-guitars.md"] },
  { keys: ["guitar"], files: ["guitars.md"] },
  { keys: ["keyboard", "piano", "synth"], files: ["keys-and-synths.md"] },
  { keys: ["drum", "percussion", "cymbal", "conga", "timbale"], files: ["drums.md", "percussion.md"] },
  { keys: ["violin", "viola", "cello"], files: ["orchestral-strings.md"] },
  { keys: ["microphone", "mic", "wireless"], files: ["microphones.md"] },
  { keys: ["interface", "apollo", "volt", "preamp"], files: ["audio-interfaces.md", "studio-workflows.md"] },
  { keys: ["headphone", "studio monitor", "monitoring"], files: ["headphones-and-monitoring.md"] },
  { keys: ["speaker", "pa", "loudspeaker", "mixer", "amplifier", "live sound", "subwoofer"], files: ["live-sound.md"] },
  { keys: ["church", "worship", "sanctuary", "congregation"], files: ["house-of-worship.md", "live-sound.md"] },
  { keys: ["stream", "ptz", "camera", "switcher", "broadcast", "video"], files: ["video-production.md", "broadcast-production.md"] },
  { keys: ["dante", "network", "aes67"], files: ["network-solutions.md"] },
  { keys: ["cable", "xlr", "hosa", "monster"], files: ["cables.md"] },
  { keys: ["school", "band program", "educator", "marching"], files: ["band-and-orchestra-programs.md"] },
  { keys: ["financ", "payment", "monthly", "lease"], files: ["financing-rules.md", "financing-and-sales.md"] }
];

function loadKnowledge(conversationText) {
  const hay = " " + conversationText.toLowerCase() + " ";
  const files = new Set(CORE_KNOWLEDGE);
  for (const entry of KNOWLEDGE_MAP) {
    if (entry.keys.some(k => hay.includes(k))) entry.files.forEach(f => files.add(f));
  }
  return [...files]
    .map(f => {
      const c = loadKnowledgeFile(f);
      return c ? `\n===== ${f} =====\n${c}` : "";
    })
    .join("\n");
}

/* ---------------- RETRIEVAL ---------------- */

// Build search queries from the parsed intent. We cast a WIDE net here and let
// the model do the judging — that's the core design change.
function buildQueries(intentData, lastUserMessage) {
  const queries = new Set();

  for (const item of intentData.requestedItems || []) {
    const parts = [item.brand, item.product, item.category, item.searchQuery].filter(Boolean);
    if (parts.length) queries.add(parts.join(" "));
    if (item.searchQuery) queries.add(item.searchQuery);
    if (item.product) queries.add(item.product);
    if (item.brand && item.category) queries.add(`${item.brand} ${item.category}`);
    if (item.category) queries.add(item.category);
  }

  if (!queries.size && lastUserMessage) queries.add(lastUserMessage);
  return [...queries].filter(Boolean).slice(0, 6);
}

async function retrieve(intentData, messages) {
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  const lastText = String(lastUser?.content || "");

  const found = new Map();

  // 1. Exact products the customer linked to always win.
  for (const handle of extractHandlesFromText(lastText)) {
    const p = findByHandle(handle);
    if (p) found.set(p.handle, p);
  }

  // 2. Search the index for each query.
  const queries = buildQueries(intentData, lastText);
  for (const q of queries) {
    for (const p of searchCatalog(q, { limit: 10, includeDrafts: true })) {
      if (!found.has(p.handle)) found.set(p.handle, p);
    }
  }

  // 3. Brand lookups: if a brand was named, pull real products for that brand.
  for (const item of intentData.requestedItems || []) {
    if (item.brand) {
      for (const p of findByVendor(item.brand, 8)) {
        if (!found.has(p.handle)) found.set(p.handle, p);
      }
    }
  }

  const candidates = [...found.values()].slice(0, 20);

  // 4. THE SECOND OPINION. If the index found nothing sellable, check the live
  //    site before Benny is ever allowed to say "I can't find that."
  const hasSellable = candidates.some(p => p.sellable);
  let liveCheck = null;
  if (!hasSellable) {
    const probe = queries[0] || lastText;
    liveCheck = await verifyBeforeSayingNo(probe);
  }

  // 5. Complete, authoritative brand list for "what brands do you carry" —
  //    a real count over the whole catalog, not a guess.
  const categoryHint = (intentData.requestedItems || [])
    .map(i => i.category || i.product)
    .filter(Boolean)
    .join(" ");
  const brands = categoryHint ? listVendorsMatching(categoryHint, 30) : [];

  return { candidates, liveCheck, brands };
}

/* ---------------- CHAT ---------------- */

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const intentData = await classifyIntentWithAI(messages);

    const conversationText = messages
      .filter(m => m.role === "user")
      .map(m => String(m.content || ""))
      .join(" ");

    const knowledge = loadKnowledge(conversationText + " " + JSON.stringify(intentData));

    const { candidates, liveCheck, brands } = await retrieve(intentData, messages);

    const slimmed = candidates.map(slim);
    const sellable = slimmed.filter(p => p.sellable);
    const draftOnly = slimmed.filter(p => !p.sellable);

    // Only sellable products get rendered as cards with prices and cart buttons.
    const recommendedProducts = sellable;

    const systemPrompt = `
You are Benny, a consultative product advisor for Victory Musical Instruments.
You are a CONSULTANT FIRST, not a salesperson.

${knowledge}

=====================================================================
YOUR TWO JOBS. THEY HAVE DIFFERENT RULES. THIS IS THE MOST IMPORTANT
THING IN THIS PROMPT.
=====================================================================

JOB 1 — THINK AND ADVISE (use your FULL knowledge of the world)

You know the entire world of music and audio gear. Use all of it. You may
freely discuss, explain, and compare ANY product that exists, including ones
Victory does not sell. You may reason about signal chains, room sizing,
channel counts, what a 200-seat sanctuary needs, why a desk monitor is not a
PA speaker. Think like a working systems engineer who has done this for years.

When a customer names a product Victory doesn't carry (e.g. a Behringer X32):
  - Acknowledge you know what it is. Don't pretend ignorance.
  - Do NOT praise it and do NOT trash it. Stay neutral about gear we don't sell.
  - Never state its price or specs as if it were ours.
  - Then say plainly you're not seeing it in our catalog.
  - ASK if they'd like to see an equivalent from what we carry. Do not force one
    on them. Offer, don't push.

JOB 2 — RECOMMEND (locked to the catalog, no exceptions)

Every product you OFFER — anything with a price, a link, or an Add to Cart —
must come from CATALOG PRODUCTS below. You may never invent a product, a price,
a spec number, a SKU, or a stock status. If it is not in the list, you cannot
sell it.

Discussing a product ≠ offering a product. You may discuss anything.
You may only OFFER what is in the list.

=====================================================================
THE CATALOG (${getCatalogCount()} products: ${getActiveCount()} sellable, ${getDraftCount()} not yet available)
=====================================================================

SELLABLE PRODUCTS — you may recommend these with price and cart:
${JSON.stringify(sellable, null, 1)}

${draftOnly.length ? `NOT YET AVAILABLE — these exist in our system but are NOT ready to sell.
You KNOW they exist. You may acknowledge them. You may NOT quote a price, give a
link, or offer a cart button for them. The correct response is: "We may be able to
source that — let me get you connected with someone on the team to confirm
availability and pricing."
${JSON.stringify(draftOnly.map(p => ({ title: p.title, vendor: p.vendor, type: p.productType })), null, 1)}` : ""}

${brands.length ? `BRANDS WE CARRY IN THIS CATEGORY (complete count from the real catalog):
${JSON.stringify(brands, null, 1)}
Note: "active" = sellable now. "draft" = in our system, not yet sellable.` : ""}

${liveCheck ? `LIVE SITE CHECK — the catalog had no sellable match, so we searched
victorymusical.com directly as a second opinion:
${liveCheck.foundOnLiveSite
  ? `The live site DID find these. The catalog may be out of date. Acknowledge these exist and offer to connect them with the team to confirm:
${JSON.stringify(liveCheck.liveResults, null, 1)}`
  : `The live site also found nothing. You may now honestly say you cannot see it.`}` : ""}

=====================================================================
HOW TO SPEAK
=====================================================================

NEVER say "we don't sell that" or "we don't carry that brand." You cannot know
that. Say instead: "I'm not able to see that in our catalog at the moment."
That is honest. The other is a claim you can't back up.

The brand list above is a REAL count from the catalog. If a brand isn't in it,
that still doesn't mean we don't carry it — it means you're not seeing it. Never
declare a brand to be the "only" one we carry.

For a whole-system request ("I need everything for my church"):
  - Ask 1-3 short scoping questions FIRST, one at a time (seats, room size,
    livestream, budget). Do not dump a product list.
  - Then design the system by ROLE (mains sized to the room, subwoofer, mixer
    with enough channels, wireless, monitors, cabling).
  - Then fill each role with a real product from the catalog.
  - If a role has no good fit, say so and offer the team. Never jam an
    undersized product into a role it can't fill.

Be concise and warm. One question at a time. Remember what they already told you.

=====================================================================
SHOWING PRODUCTS
=====================================================================

Do NOT paste URLs or "Add to cart:" text. The page draws product cards for you.

To show a product, write one sentence about it, then put a marker on its OWN line:
[[PRODUCT:handle]]

Use the exact "handle" from SELLABLE PRODUCTS. Only sellable products get markers.
Never put a marker on a not-yet-available product — it has no price and no cart.

Do not write prices yourself. The card shows them.

=====================================================================
CLOSING
=====================================================================

Help them explore, learn, design, and build a cart. You can assemble a
multi-item system and summarize it, but never claim an order has been placed.
When they're ready, or when something needs a human, invite them to talk with
the Victory team to confirm final availability and pricing. Frame it as the
natural next step, not as you failing. Never overpromise.
`.trim();

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.4,
      messages: [{ role: "system", content: systemPrompt }, ...messages]
    });

    res.json({
      reply: response.choices[0].message.content,
      recommendedProducts,
      draftProducts: draftOnly,
      brands,
      liveCheck,
      intentData,
      catalogStats: {
        total: getCatalogCount(),
        active: getActiveCount(),
        draft: getDraftCount()
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Benny encountered an error.", details: error.message });
  }
});

export default router;
