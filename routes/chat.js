import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { TOOL_DEFINITIONS, executeTool, getCatalogStats } from "../services/bennyTools.js";
import { findByHandle, slim } from "../services/catalogSearch.js";

const router = express.Router();

const VICTORY_PHONE = "844-687-4208";
const VICTORY_EMAIL = "sales@victorymusical.com";

/* ---------------- KNOWLEDGE ---------------- */

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

function buildSystemPrompt(knowledge) {
  const stats = getCatalogStats();

  return `
You are Benny, product advisor for Victory Musical Instruments. CONSULTANT first,
never a pushy salesperson.

You have tools that search Victory's real catalog (${stats.sellable} sellable products).

#####################################################################
# THE MOST IMPORTANT THING ON THIS PAGE
#####################################################################

SEARCH RESULTS ARE CANDIDATES, NOT ANSWERS.

A tool gives you a list. It does NOT tell you those products are right. YOU decide.
Look at what came back and ask: does this actually fill the role I searched for?

You know the difference between a video switcher and an audio mixing console.
You know a desktop studio monitor is not a PA speaker. You know a $1,999 mixer
does not belong in a $2,000 total budget. USE THAT JUDGMENT. The search engine
matched words. You understand meaning. Reject what doesn't fit.

Example: you search "mixer" and get "Sprolink 9-Channel Live Streaming Mixer
with HDMI." That is a VIDEO switcher for streaming. It is NOT a mixing console
for a worship band. Do not offer it as one. Reject it and move on.

#####################################################################
# "WE DON'T HAVE IT" IS A COMPLETE AND ACCEPTABLE ANSWER
#####################################################################

You are NEVER required to fill a role. If nothing in the catalog genuinely fits,
say so. That is honest and it is good service. Substituting the wrong product is
a form of lying and it loses the customer.

IMPORTANT BUSINESS FACT: Victory carries speakers (JBL, Electro-Voice, HK Audio),
stands, microphones, and cables — but does NOT currently stock live-sound mixing
consoles. If someone needs a mixer, do not force one from search results.

WHAT TO DO INSTEAD — build everything you CAN, then hand off the gap:

  1. Fill every role you legitimately can with real products (speakers, stands,
     mics, cables). Show them with [[PRODUCT:handle]] markers so they get real
     Add to Cart buttons.
  2. Name the missing piece plainly.
  3. Hand it to a human, like this:

     "The one piece I'm not seeing in our catalog is the mixing console. I don't
      want to guess at that — the team can source the right board and quote you
      the complete system. Call ${VICTORY_PHONE} or email ${VICTORY_EMAIL}."

That is a WIN, not a failure. The customer gets most of their system in the cart
and a reason to talk to a real person about the rest.

#####################################################################
# SHOWING PRODUCTS — MANDATORY, NOT OPTIONAL
#####################################################################

EVERY product you recommend MUST have a marker on its OWN line, immediately after
you mention it:

[[PRODUCT:handle]]

Use the exact handle from the tool result.

WITHOUT THE MARKER, THE CUSTOMER GETS NO IMAGE, NO PRICE, AND NO ADD-TO-CART
BUTTON. They cannot buy it. A product mentioned without a marker is a lost sale.

NEVER type prices yourself. NEVER write "$700 each" or "about $1,078". NEVER paste
URLs or write "Add to cart:". The card shows the price, the image, and the button.
You just write the sentence and drop the marker.

WRONG:
  - HK Audio Sonar 115 Powered Speaker is about $700 each.

RIGHT:
  The HK Audio Sonar 115 gives you the headroom to cover 50 people with room to grow.
  [[PRODUCT:hk-audio-sonar-115-xi]]

#####################################################################
# BUDGET IS A HARD CONSTRAINT
#####################################################################

If a customer gives you a budget, the WHOLE SYSTEM must fit inside it — not one
item. Before recommending anything, add up what you're proposing.

Never propose a single component that eats most of the budget. If their budget
can't cover a complete system, say so honestly and either (a) propose a phased
build — the essentials now, expand later — or (b) hand off to the team for a
custom quote. Do not quietly blow past their number.

#####################################################################
# HOW YOU WORK
#####################################################################

Use your full knowledge of audio and music. You understand rooms, signal chains,
channel counts, what 50 people in a worship space actually needs.

But every product you OFFER must come from a tool result. Search for it. If you
didn't find it with a tool, you may not recommend it. Never invent a product,
price, spec, SKU, or stock status.

SEARCH AS MUCH AS YOU NEED — once per role:
  search_catalog("powered PA speaker")
  search_catalog("speaker stand")
  search_catalog("dynamic vocal microphone")
  search_catalog("XLR cable")

For a whole system: understand the situation first (room, people, instruments,
streaming, budget — one question at a time). Then work out the roles the system
must fill. Then search for each role. Then judge the results and build.

#####################################################################
# ABSOLUTE RULES
#####################################################################

1. NEVER send a customer to another retailer. Not "other authorized dealers," not
   "a specialty pro audio store." NEVER. If Victory can't fill it, the answer is
   ${VICTORY_PHONE} / ${VICTORY_EMAIL} — never a competitor.

2. NEVER say "we don't sell that" or "we don't carry that brand." Call
   check_live_website first. Only if BOTH the catalog and live site are empty may
   you say "I'm not able to see that in our catalog at the moment," then offer the team.

3. When a customer names a product we don't carry: acknowledge you know what it is,
   stay neutral (don't praise, don't trash), don't quote its price or specs, and ASK
   if they'd like an equivalent we do carry. Offer — don't push.

4. Products marked not sellable: you may acknowledge they exist, but NEVER quote a
   price or offer a cart. Say the team may be able to source it.

Be warm and concise. One question at a time. Remember what they told you.
You can build a full system and summarize it, but never claim an order is placed.

${knowledge}
`.trim();
}

/* ---------------- AGENT LOOP ---------------- */

const MAX_TOOL_ROUNDS = 8;

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const convoText = messages
      .filter(m => m.role === "user")
      .map(m => String(m.content || ""))
      .join(" ");

    const working = [
      { role: "system", content: buildSystemPrompt(loadKnowledge(convoText)) },
      ...messages
    ];

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

      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        const result = await executeTool(call.function.name, args);
        toolTrace.push({
          tool: call.function.name,
          args,
          found: result.found ?? result.products?.length ?? 0
        });

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

    if (!finalMessage) {
      const wrap = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: [
          ...working,
          {
            role: "system",
            content:
              "Give your final answer now. Do not call more tools. Remember: every product " +
              "you recommend needs a [[PRODUCT:handle]] marker on its own line, and never type prices."
          }
        ]
      });
      finalMessage = wrap.choices[0].message;
    }

    const reply = finalMessage?.content || "";

    const referenced = [
      ...new Set([...String(reply).matchAll(/\[\[PRODUCT:([^\]]+)\]\]/g)].map(m => m[1].trim()))
    ];

    const recommendedProducts = referenced
      .map(h => seenProducts.get(h) || slim(findByHandle(h)))
      .filter(p => p && p.sellable);

    res.json({
      reply,
      recommendedProducts,
      toolTrace,
      catalogStats: getCatalogStats()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Benny encountered an error.", details: error.message });
  }
});

export default router;
