import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { TOOL_DEFINITIONS, executeTool, getCatalogStats } from "../services/bennyTools.js";
import { findByHandle, slim } from "../services/catalogSearch.js";

const router = express.Router();

/* ---------------- KNOWLEDGE (topic-scoped, not the whole library) ---------------- */

function loadFile(f) {
  try {
    return fs.readFileSync(path.join(process.cwd(), "knowledge", f), "utf8");
  } catch {
    return "";
  }
}

const CORE = ["sales-methodology.md", "conversational-rules.md", "greeting-rules.md"];

const TOPICS = [
  { k: ["sax", "saxophone"], f: ["saxophones.md", "reed-instruments.md"] },
  { k: ["clarinet", "oboe", "bassoon"], f: ["reed-instruments.md"] },
  { k: ["flute", "piccolo"], f: ["flutes-piccolos.md"] },
  { k: ["trumpet", "cornet", "flugel"], f: ["high-brass.md"] },
  { k: ["trombone"], f: ["trombones.md", "low-brass.md"] },
  { k: ["euphonium", "tuba", "french horn"], f: ["low-brass.md"] },
  { k: ["bass guitar", "electric bass"], f: ["bass-guitars.md"] },
  { k: ["guitar"], f: ["guitars.md"] },
  { k: ["keyboard", "piano", "synth"], f: ["keys-and-synths.md"] },
  { k: ["drum", "percussion", "cymbal", "conga"], f: ["drums.md", "percussion.md"] },
  { k: ["violin", "viola", "cello"], f: ["orchestral-strings.md"] },
  { k: ["microphone", "mic", "wireless"], f: ["microphones.md"] },
  { k: ["interface", "apollo", "volt", "preamp"], f: ["audio-interfaces.md", "studio-workflows.md"] },
  { k: ["headphone", "studio monitor"], f: ["headphones-and-monitoring.md"] },
  { k: ["speaker", "pa", "loudspeaker", "mixer", "amplifier", "live sound", "sound system", "subwoofer"], f: ["live-sound.md"] },
  { k: ["church", "worship", "sanctuary", "congregation"], f: ["house-of-worship.md", "live-sound.md"] },
  { k: ["stream", "ptz", "camera", "switcher", "broadcast", "video"], f: ["video-production.md", "broadcast-production.md"] },
  { k: ["dante", "network"], f: ["network-solutions.md"] },
  { k: ["cable", "xlr"], f: ["cables.md"] },
  { k: ["school", "band program", "educator", "marching"], f: ["band-and-orchestra-programs.md"] },
  { k: ["financ", "payment", "monthly", "lease"], f: ["financing-rules.md", "financing-and-sales.md"] }
];

function loadKnowledge(text) {
  const hay = " " + text.toLowerCase() + " ";
  const files = new Set(CORE);
  for (const t of TOPICS) if (t.k.some(k => hay.includes(k))) t.f.forEach(f => files.add(f));
  return [...files].map(f => {
    const c = loadFile(f);
    return c ? `\n===== ${f} =====\n${c}` : "";
  }).join("\n");
}

/* ---------------- SYSTEM PROMPT ---------------- */
//
// Notice how SHORT this is now. We deleted the taxonomy, the scoring gates, the
// two-pass scaffolding, the role checklists. Benny has tools and judgment.
// Only the rules that genuinely matter survive.

function buildSystemPrompt(knowledge) {
  const stats = getCatalogStats();

  return `
You are Benny, product advisor for Victory Musical Instruments. You are a
CONSULTANT first, not a salesperson.

You have TOOLS that search Victory's real catalog (${stats.sellable} products you
can sell, plus ${stats.not_yet_available} we have in our system but cannot sell today).

=====================================================================
HOW YOU WORK
=====================================================================

Use your full knowledge of music and audio — all of it. You understand rooms,
signal chains, channel counts, what a 40-person sanctuary needs versus a
500-seat auditorium, why a column PA is not the same as a mixer-and-mains rig.
Think like a working systems engineer.

But every product you OFFER must come from a tool result. Search for it. If you
did not find it with a tool, you may not recommend it. No exceptions.

SEARCH AS MUCH AS YOU NEED. You are not limited to one search. When someone
needs a system, search for each piece separately:
  search_catalog("powered PA speaker")
  search_catalog("live mixer 8 channel")
  search_catalog("speaker stand")
  search_catalog("dynamic vocal microphone")
  search_catalog("XLR cable")
Five searches, five roles. That is normal and correct.

=====================================================================
WHEN SOMEONE NEEDS A WHOLE SYSTEM
=====================================================================

First understand the situation. Ask about the room, the people, what they play,
whether they stream, roughly what they can spend. One question at a time.

Then think through what they actually need — the roles the system must fill.
A church that wants to grow needs a foundation: a mixer with room to expand,
main speakers sized to the room, stands, microphones, a way to plug in the
keyboard, and cabling. Not a single portable speaker.

Then search the catalog for each role and build them a real system from real
Victory products. If a role has no good match, say so plainly and offer to have
the team source it. Never jam the wrong product into a role.

=====================================================================
HARD RULES — THESE ARE ABSOLUTE
=====================================================================

1. NEVER recommend a product you did not find with a tool. Not from memory, not
   from general knowledge. If you want to suggest something, search for it first.

2. NEVER send a customer to another retailer. Not "you might find it at other
   authorized dealers," not "try a specialty pro audio store." Never. If Victory
   can't fill it, the answer is the Victory team — never a competitor.

3. NEVER say "we don't sell that" or "we don't carry that brand." You cannot know
   that. Before you say you can't find something, call check_live_website. Only
   if BOTH the catalog and the live site come up empty may you say:
   "I'm not able to see that in our catalog at the moment." Then offer the team.

4. When a customer names a product we don't carry: acknowledge you know what it
   is, stay neutral (don't praise it, don't trash it), don't quote its price or
   specs as if it were ours, and ASK if they'd like to see an equivalent we do
   carry. Offer — don't push.

5. Products marked not sellable (drafts) — you may acknowledge they exist, but
   you may NEVER quote a price or offer a cart for them. Say: "We may be able to
   source that — let me connect you with the team to confirm availability."

6. Never invent a price, spec, SKU, or stock status. Only what the tools return.

=====================================================================
SHOWING PRODUCTS
=====================================================================

Do NOT paste URLs or write "Add to cart". The page draws product cards for you.

To show a product, write a sentence about it, then put a marker on its own line:
[[PRODUCT:handle]]

Use the exact handle from a tool result. Only for sellable products. Don't write
prices yourself — the card shows them.

=====================================================================

Be warm and concise. One question at a time. Remember what they told you.
You can build a full system and summarize it, but never claim an order is placed.
When they're ready, invite them to talk with the Victory team to finalize.

${knowledge}
`.trim();
}

/* ---------------- AGENT LOOP ---------------- */

const MAX_TOOL_ROUNDS = 8; // enough for a full system build (6+ role searches)

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const convoText = messages
      .filter(m => m.role === "user")
      .map(m => String(m.content || ""))
      .join(" ");

    const knowledge = loadKnowledge(convoText);

    const working = [
      { role: "system", content: buildSystemPrompt(knowledge) },
      ...messages
    ];

    // Every product Benny actually saw via tools. The frontend renders cards
    // only from these, so a card can never exist for a product he didn't find.
    const seenProducts = new Map();
    const toolTrace = [];

    let finalMessage = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: working,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto"
      });

      const msg = response.choices[0].message;
      working.push(msg);

      const calls = msg.tool_calls || [];

      if (!calls.length) {
        finalMessage = msg;
        break;
      }

      // Run every tool Benny asked for.
      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        const result = await executeTool(call.function.name, args);

        toolTrace.push({ tool: call.function.name, args, found: result.found ?? result.products?.length });

        // Remember every sellable product he saw, so the UI can render its card.
        const collect = p => {
          if (p && p.handle && p.sellable) seenProducts.set(p.handle, p);
        };
        (result.products || []).forEach(collect);
        if (result.product) collect(result.product);

        working.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result)
        });
      }
    }

    // Safety: if he burned all rounds on tools, ask for a final answer.
    if (!finalMessage) {
      const wrap = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: [
          ...working,
          {
            role: "system",
            content: "Give your final answer to the customer now, using what you found. Do not call more tools."
          }
        ]
      });
      finalMessage = wrap.choices[0].message;
    }

    const reply = finalMessage?.content || "";

    // Cards come ONLY from products Benny actually retrieved AND referenced.
    const referenced = [
      ...new Set([...String(reply).matchAll(/\[\[PRODUCT:([^\]]+)\]\]/g)].map(m => m[1].trim()))
    ];

    const recommendedProducts = referenced
      .map(h => seenProducts.get(h) || slim(findByHandle(h)))
      .filter(p => p && p.sellable);

    res.json({
      reply,
      recommendedProducts,
      toolTrace,          // useful for debugging what Benny searched for
      catalogStats: getCatalogStats()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Benny encountered an error.", details: error.message });
  }
});

export default router;
