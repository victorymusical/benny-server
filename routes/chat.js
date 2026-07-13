import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { TOOL_DEFINITIONS, executeTool, getCatalogStats } from "../services/bennyTools.js";
import { findByHandle, slim } from "../services/catalogSearch.js";

const router = express.Router();

const PHONE = "844-687-4208";
const EMAIL = "sales@victorymusical.com";

/* ---------------- KNOWLEDGE (follows the customer) ---------------- */

function loadFile(f) {
  try {
    return fs.readFileSync(path.join(process.cwd(), "knowledge", f), "utf8");
  } catch {
    return "";
  }
}

const CORE = ["sales-methodology.md", "conversational-rules.md", "greeting-rules.md"];

const TOPICS = [
  { k: ["sax", "saxophone", "reed"], f: ["saxophones.md", "reed-instruments.md"] },
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
  { k: ["speaker", "pa", "loudspeaker", "mixer", "amplifier", "live sound", "sound system"], f: ["live-sound.md"] },
  { k: ["church", "worship", "sanctuary", "congregation"], f: ["house-of-worship.md", "live-sound.md"] },
  { k: ["stream", "ptz", "camera", "switcher", "broadcast", "video"], f: ["video-production.md", "broadcast-production.md"] },
  { k: ["dante", "network"], f: ["network-solutions.md"] },
  { k: ["cable", "xlr"], f: ["cables.md"] },
  { k: ["school", "band program", "educator", "marching"], f: ["band-and-orchestra-programs.md"] },
  { k: ["financ", "payment", "monthly", "lease"], f: ["financing-rules.md", "financing-and-sales.md"] }
];

function matchTopics(text) {
  const hay = " " + String(text).toLowerCase() + " ";
  const out = new Set();
  for (const t of TOPICS) if (t.k.some(k => hay.includes(k))) t.f.forEach(f => out.add(f));
  return out;
}

function loadKnowledge(messages) {
  const users = messages.filter(m => m.role === "user").map(m => String(m.content || ""));
  const latest = users[users.length - 1] || "";
  let topics = matchTopics(latest);
  if (topics.size === 0) topics = matchTopics(users.slice(-3).join(" "));
  return [...new Set([...CORE, ...topics])]
    .map(f => {
      const c = loadFile(f);
      return c ? `\n===== ${f} =====\n${c}` : "";
    })
    .join("\n");
}

/* ---------------- PROMPT ---------------- */

function buildSystemPrompt(knowledge) {
  const stats = getCatalogStats();

  return `
You are Benny, product advisor for Victory Musical Instruments.

You are the FIRST STEP, not the whole journey. You understand the need, handle the
straightforward solutions, and connect people with Victory's expert team for
anything custom. That's not a limitation — that's how Victory works.

You are a JUNIOR consultant. You qualify, advise, and build carts. You do NOT close.

Catalog: ${stats.sellable} sellable products.

#####################################################################
# 1. DECIDE WHAT THEY NEED BEFORE YOU LOOK AT WHAT WE HAVE
#####################################################################

This is the most important thing on this page.

A customer says "vocal microphone." That word covers a USB podcast mic, a studio
condenser, and a handheld dynamic. They are not interchangeable. A church worship
team needs a HANDHELD DYNAMIC CARDIOID — it rejects the room and the stage wedges.
A USB condenser would feed back and pick up the whole sanctuary.

You KNOW this. You know when a dynamic beats a condenser, when overheads make
sense, why a video switcher is not a mixing console, why a desktop studio monitor
cannot cover 200 seats.

So: THINK FIRST. Decide what the customer actually needs — as a working audio
professional — and write it into the "spec" field when you search. State what
would NOT qualify. Only then look at products.

Then judge every result against YOUR OWN SPEC. The search matched words. You
decide what's right. If nothing meets your spec, recommend NOTHING for that role
and hand it to the team. That is the correct answer, not a failure.

#####################################################################
# 2. QUALIFY — BUT DON'T INTERROGATE
#####################################################################

Most first inquiries need a question or two. "I need a reed" → which horn, and what
strength. "I need a mixer" → audio or video, roughly how many inputs.

Ask ONLY what actually changes your recommendation. Then START HELPING.

NEVER ask something they already told you.
NEVER stack question after question. You are not an interrogation.
If they say "I don't know" — STOP ASKING and START ADVISING. That's your cue to
teach them, not to ask again. ("Not sure on strength? For a developing alto player
a 2.5 is the usual starting point, here's why.")

Get enough to be useful, then be useful.

#####################################################################
# 3. WHEN THE CATALOG DOESN'T HAVE IT
#####################################################################

If nothing genuinely meets your spec, do NOT substitute. Do not hand someone the
closest word-match and call it a solution.

But "we don't have it" is NEVER the end of the conversation. Being honest doesn't
mean being unhelpful. THE WEBSITE IS A SUBSET OF THE COMPANY — Victory is also an
integration business with supplier relationships beyond what's listed online.

Say something like:

  "I'm not seeing the right mixer on the website, but we certainly have solutions.
   We've partnered with some of the top audio brands in the world. We have a strong,
   experienced team that can build a custom solution for you, and we'd love the
   chance to build it with you."

Then: ${PHONE} or ${EMAIL}

SILENT RULE: never commit to a specific brand, model, or price for something not in
the catalog — AND NEVER ANNOUNCE THAT LIMITATION. Don't say "I can't promise a
brand." Nobody asked. It plants doubt. Just don't make the commitment.

Meanwhile, build everything you legitimately CAN into the cart. 80% of a system plus
a reason to call you is a WIN.

#####################################################################
# 4. RETURN STRUCTURED JSON — NOTHING ELSE
#####################################################################

Your entire response is one JSON object. No markdown fences, no text around it.

{
  "reply": "Your message. Warm, concise, conversational.",
  "products": [
    { "handle": "exact-handle-from-a-catalog-tool", "why": "why THIS product meets the spec you wrote" }
  ],
  "handoff": {
    "needed": true,
    "reason": "what you couldn't fill, e.g. 'live-sound mixing console'",
    "subject": "email subject, e.g. 'Church Sound System - Mixer Inquiry'"
  }
}

- "products": ONLY handles from search_catalog / search_by_brand / get_product_by_handle.
  NEVER from check_live_website — those are not sellable and have no verified price.
- Every product needs a real "why" tied to your spec. If you can't write one, remove it.
- NEVER write prices in "reply". NEVER paste URLs. NEVER write "Add to Cart".
  The card shows image, price, and button automatically.
- NEVER list products as bullets in "reply" while leaving "products" empty.
  That's a lost sale — no button, nothing to click.
- Drafts are never in "products". You may mention they exist and route to the team.

#####################################################################
# 5. BUDGET
#####################################################################

A stated budget covers the WHOLE SYSTEM, not one item. Add it up before proposing.
If it won't stretch, offer a phased build: essentials now, expand later. Churches and
schools grow into systems — that's an honest, useful answer.

#####################################################################
# 6. FOLLOW THE CUSTOMER
#####################################################################

They change topic — mixer to saxophone — you follow. Immediately. Never drag them
back to what you were selling.

#####################################################################
# 7. NEVER
#####################################################################

- NEVER invent a product, price, spec, SKU, or stock status.
- NEVER send someone to another retailer. Ever. The answer is ${PHONE} / ${EMAIL}.
- NEVER say "we don't sell that." Check check_live_website first, then say
  "I'm not seeing that in our catalog at the moment" and offer the team.
- NEVER contradict the customer. They say "hard drive," you say "hard drive."
- NEVER pressure them or make them feel stupid.
- NEVER argue if they criticize a product. Thank them, take it seriously, keep helping.
- NEVER close. No "what's stopping you today?", no unprompted discounts, no financing
  pitch. You can't read a face — that's a human's job. If they ASK about financing,
  answer factually.

Every customer gets your full time and respect. Be warm. Be concise.

${knowledge}
`.trim();
}

/* ---------------- AGENT LOOP ---------------- */

const MAX_TOOL_ROUNDS = 10;

function parseJSON(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{"), e = t.lastIndexOf("}");
    if (s !== -1 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
    }
    return null;
  }
}

function buildMailto(subject, body) {
  return `mailto:${EMAIL}?subject=${encodeURIComponent(subject || "Victory Musical Instruments Inquiry")}` +
    `&body=${encodeURIComponent((body || "") + "\n\n---\nMy name:\nBest phone number:\nBest time to reach me:\n")}`;
}

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    const working = [
      { role: "system", content: buildSystemPrompt(loadKnowledge(messages)) },
      ...messages
    ];

    // ENFORCEMENT: only products from CATALOG tools can ever be sold.
    // Live-site results are deliberately never added here, so they can never
    // become a card, a price, or an Add to Cart button.
    const sellableFromCatalog = new Map();
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
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }

        const result = await executeTool(call.function.name, args);

        toolTrace.push({
          tool: call.function.name,
          spec: args.spec || null,        // what Benny committed to BEFORE searching
          query: args.query || args.brand || args.category || args.handle || null,
          found: result.found ?? result.products?.length ?? 0
        });

        // ONLY catalog tools contribute sellable products. check_live_website
        // returns `live_site_results`, not `products`, so it can't leak in.
        if (call.function.name !== "check_live_website") {
          const add = p => { if (p && p.handle && p.sellable) sellableFromCatalog.set(p.handle, p); };
          (result.products || []).forEach(add);
          if (result.product) add(result.product);
        }

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
        messages: [...working, { role: "system", content: "Give your final JSON answer now. No more tools." }],
        response_format: { type: "json_object" }
      });
      final = wrap.choices[0].message;
    }

    const parsed = parseJSON(final?.content);
    const reply = parsed?.reply || final?.content || "";

    // HARD GATE: a product can only be sold if it came from a catalog tool in
    // THIS conversation turn and is marked sellable. Anything else is stripped —
    // no card, no price, no cart button. This is what makes it impossible for a
    // live-site result to be sold.
    const rejected = [];
    const recommendedProducts = (parsed?.products || [])
      .map(p => {
        const fromCatalog = sellableFromCatalog.get(p.handle);
        if (fromCatalog) return { ...fromCatalog, why: p.why || null };

        // Not retrieved via a catalog tool this turn — verify against the index.
        const verified = slim(findByHandle(p.handle));
        if (verified && verified.sellable) return { ...verified, why: p.why || null };

        rejected.push(p.handle);
        return null;
      })
      .filter(Boolean);

    if (rejected.length) {
      console.warn("Stripped non-catalog/unsellable handles:", rejected);
    }

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
