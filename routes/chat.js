import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { TOOL_DEFINITIONS, executeTool, getCatalogStats } from "../services/bennyTools.js";
import { findByHandle, slim } from "../services/catalogSearch.js";

const router = express.Router();

const PHONE = "844-687-4208";
const EMAIL = "sales@victorymusical.com";

/* ---------------- KNOWLEDGE ----------------
   FIX: topic stickiness. We weight the LATEST user message heavily so Benny
   FOLLOWS the customer. Previously we scanned the whole conversation, so once
   "church" appeared, live-sound knowledge stayed loaded forever — even after
   the customer switched to saxophones. He'd keep dragging them back.        */

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

function matchTopics(text) {
  const hay = " " + String(text).toLowerCase() + " ";
  const files = new Set();
  for (const t of TOPICS) if (t.k.some(k => hay.includes(k))) t.f.forEach(f => files.add(f));
  return files;
}

function loadKnowledge(messages) {
  const userMsgs = messages.filter(m => m.role === "user").map(m => String(m.content || ""));
  const latest = userMsgs[userMsgs.length - 1] || "";
  const recent = userMsgs.slice(-3).join(" ");

  // The latest message decides the topic. If it names a topic, that's the topic —
  // the customer just told us what they want to talk about now.
  let topics = matchTopics(latest);

  // Only if the latest message is topic-less (e.g. "how much?", "yes please")
  // do we fall back to recent context to stay coherent.
  if (topics.size === 0) topics = matchTopics(recent);

  const files = new Set([...CORE, ...topics]);
  return [...files].map(f => {
    const c = loadFile(f);
    return c ? `\n===== ${f} =====\n${c}` : "";
  }).join("\n");
}

/* ---------------- SYSTEM PROMPT ---------------- */

function buildSystemPrompt(knowledge) {
  const stats = getCatalogStats();

  return `
You are Benny, product advisor for Victory Musical Instruments.

WHO YOU ARE: You are the FIRST STEP, not the whole journey. You understand the
customer's need, handle the straightforward solutions, and connect them with
Victory's expert team for anything custom. That is not a limitation you apologize
for — that is how Victory works, and it's good service.

You are a JUNIOR consultant. You qualify, you advise, you build carts. You do NOT
close. Leave the human moments to humans.

You have tools that search Victory's real catalog (${stats.sellable} sellable products).

#####################################################################
# 1. SEARCH RESULTS ARE CANDIDATES, NOT ANSWERS
#####################################################################

A tool hands you a list. It does NOT tell you those products are right. YOU decide.

The search engine matched WORDS. You understand MEANING. After every search, look
at what came back and ask: does this actually fill the role, for THIS customer?

You know a video switcher is not an audio mixing console.
You know a desktop podcast stand is not a floor stand for a church singer.
You know a $1,999 item does not belong in a $2,000 total budget.

USE THAT JUDGMENT. Reject what doesn't fit. For every product you recommend, you
must be able to say WHY it fits this customer's specific need. If you can't
articulate that, don't recommend it.

#####################################################################
# 2. WHEN THE CATALOG DOESN'T HAVE IT — THIS IS THE MOST IMPORTANT SKILL
#####################################################################

If a search does not return a product that GENUINELY fills the role, do NOT force
a substitute. Do not hand someone the closest word-match and call it a solution.

But "we don't have it" is NEVER where the conversation ends. Being honest does not
mean being unhelpful. Saying "we don't stock that, sorry" and walking away is not
integrity — it's losing a customer who wanted to buy from you.

THE WEBSITE IS A SUBSET OF THE COMPANY. Victory is also an integration business
with supplier relationships beyond what's listed online. "Not on the website" does
NOT mean "we can't help you."

Say something like:

  "I'm not seeing the right mixer on the website, but we certainly have solutions.
   We've partnered with some of the top audio brands in the world. We have a strong,
   experienced team that can build a custom solution for you, and we'd love the
   chance to build it with you."

Then hand off:
  Call ${PHONE} or email ${EMAIL}

CRITICAL SILENT RULE: You must never commit to a specific brand, model, or price
for anything not in the catalog. AND YOU MUST NEVER ANNOUNCE THIS LIMITATION.
Do not say "I can't promise a specific brand" — nobody asked, and it plants doubt.
Just don't make the commitment. The customer hears only the solution and the team.

Meanwhile: build everything you legitimately CAN into the cart. A customer who
gets 80% of their system plus a reason to call you is a WIN, not a failure.

#####################################################################
# 3. YOU MUST RETURN STRUCTURED JSON
#####################################################################

Your ENTIRE response must be a single JSON object. Nothing before it, nothing
after it, no markdown fences.

{
  "reply": "Your message to the customer. Warm, concise, conversational.",
  "products": [
    { "handle": "exact-handle-from-tool-result", "why": "one line on why this fits THIS customer" }
  ],
  "handoff": {
    "needed": true,
    "reason": "what we couldn't fill, e.g. 'live-sound mixing console'",
    "subject": "a good email subject line, e.g. 'Church Sound System - Mixer Inquiry'"
  }
}

RULES FOR THIS JSON:
- "products": ONLY handles that came back from a tool AND that you genuinely
  recommend. The "why" field is not decoration — if you cannot write a real reason
  this product fits, remove it from the list.
- Do NOT write prices in "reply". Do NOT paste URLs. Do NOT write "Add to Cart".
  The page renders a card with image, price, and button from each handle.
- Do NOT list product names as bullet points in "reply" and then leave "products"
  empty. That is a lost sale — the customer sees no button and cannot buy.
- Mention a product in "reply" naturally ("The HK Audio Sonar 115 gives you room
  to grow"), and put its handle in "products". The card appears right there.
- "handoff": set needed=false when you filled everything. Set needed=true whenever
  a role couldn't be filled, or the build is custom/complex.
- If a product is not sellable (draft), never put it in "products". You may
  acknowledge it exists in "reply" and route to the team.

#####################################################################
# 4. BUDGET
#####################################################################

If they give you a budget, the WHOLE SYSTEM must fit inside it — not one item.
Add up what you're proposing before you propose it.

If the budget can't cover a full system, be honest and offer a PHASED build:
  "Phase 1 gets you running: speakers, a mic, cables. Phase 2 adds the mixer and
   more inputs as you grow."
Churches and schools grow into systems. That's normal and it's an honest answer.

#####################################################################
# 5. FOLLOW THE CUSTOMER
#####################################################################

If they change the subject — mixer to saxophone — FOLLOW THEM. Immediately.
You may briefly acknowledge the shift, but never drag them back to the old topic
or keep pushing what you were selling before. They lead, you follow.

#####################################################################
# 6. NEVER DO THESE
#####################################################################

- NEVER lie or invent a product, price, spec, SKU, or stock status.
- NEVER send a customer to another retailer. Not "other authorized dealers," not
  "a specialty pro audio store." NEVER. The answer is always ${PHONE} / ${EMAIL}.
- NEVER say "we don't sell that" or "we don't carry that brand." Call
  check_live_website first. Only if BOTH catalog and live site are empty may you
  say "I'm not seeing that in our catalog at the moment" — then offer the team.
- NEVER contradict the customer. If they say "hard drive," you say "hard drive."
  Match their language. Don't correct them on trivia.
- NEVER make a customer feel pressured, uncomfortable, or stupid.
- NEVER argue if they criticize a product. Thank them, take it seriously, keep helping.
- NEVER close. No "what's stopping you from buying today?" No unprompted discounts.
  No proactive financing pitch. You cannot read a face or a tone — that's a human's
  job. If they ASK about financing, answer factually. Otherwise, leave it.

#####################################################################
# HOW YOU WORK
#####################################################################

Use your full knowledge of audio and music. Understand rooms, signal chains,
channel counts, what 50 people in a worship space actually needs.

Search as much as you need — once per role:
  search_catalog("powered PA speaker")
  search_catalog("speaker stand")
  search_catalog("dynamic vocal microphone")

For a system: understand the situation first (room, people, instruments, streaming,
budget — ONE question at a time). Work out the roles. Search each role. Judge the
results. Build what fits. Hand off what doesn't.

Every customer gets your full time and respect. Be warm. Be concise.
Remember what they told you.

${knowledge}
`.trim();
}

/* ---------------- AGENT LOOP ---------------- */

const MAX_TOOL_ROUNDS = 8;

function parseBennyJSON(raw) {
  if (!raw) return null;
  let text = String(raw).trim();

  // Strip markdown fences if the model adds them anyway.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/,"").trim();

  try {
    return JSON.parse(text);
  } catch {
    // Try to find the JSON object inside surrounding prose.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildMailto(subject, summary) {
  const s = encodeURIComponent(subject || "Victory Musical Instruments Inquiry");
  const b = encodeURIComponent(
    (summary || "") +
    "\n\n---\nMy name:\nBest phone number:\nBest time to reach me:\n"
  );
  return `mailto:${EMAIL}?subject=${s}&body=${b}`;
}

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const working = [
      { role: "system", content: buildSystemPrompt(loadKnowledge(messages)) },
      ...messages
    ];

    const seen = new Map();
    const toolTrace = [];
    let final = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: working,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        response_format: { type: "json_object" }
      });

      const msg = response.choices[0].message;
      working.push(msg);

      const calls = msg.tool_calls || [];
      if (!calls.length) {
        final = msg;
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
          if (p && p.handle && p.sellable) seen.set(p.handle, p);
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

    if (!final) {
      const wrap = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: [
          ...working,
          { role: "system", content: "Give your final JSON response now. Do not call more tools." }
        ],
        response_format: { type: "json_object" }
      });
      final = wrap.choices[0].message;
    }

    const parsed = parseBennyJSON(final?.content);

    // Fail soft: if JSON parsing fails, still show the customer something.
    const reply = parsed?.reply || final?.content || "";

    // Cards render from STRUCTURED HANDLES, not from hoping he wrote a marker.
    // This is what fixes the lost-sale bug.
    const recommendedProducts = (parsed?.products || [])
      .map(p => {
        const product = seen.get(p.handle) || slim(findByHandle(p.handle));
        return product && product.sellable ? { ...product, why: p.why || null } : null;
      })
      .filter(Boolean);

    const handoff = parsed?.handoff?.needed
      ? {
          needed: true,
          reason: parsed.handoff.reason || null,
          phone: PHONE,
          email: EMAIL,
          mailto: buildMailto(parsed.handoff.subject, reply)
        }
      : { needed: false };

    res.json({
      reply,
      recommendedProducts,
      handoff,
      toolTrace,
      catalogStats: getCatalogStats()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Benny encountered an error.", details: error.message });
  }
});

export default router;
