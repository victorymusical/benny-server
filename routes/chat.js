import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";
import { TOOL_DEFINITIONS, executeTool, getCatalogStats } from "../services/bennyTools.js";
import { findByHandle, slim } from "../services/catalogSearch.js";
import { runAssessment } from "../services/assessment.js";
import { validateFit } from "../services/validator.js";

const router = express.Router();

const PHONE = "844-687-4208";
const EMAIL = "sales@victorymusical.com";

/* =====================================================================
   THE PIPELINE:  ASSESS -> (DISCOVER) -> SEARCH -> VALIDATE -> SELL

   Stage 1 ASSESS   (assessment.js, no tools): understand the situation
                    like a professional. Decides the turn's mode.
   Stage 2 DISCOVER (no tools, no catalog): if a key detail is missing,
                    the assessment's reply IS the answer. One fast call.
   Stage 3 SEARCH   (agent loop with tools): searches per the assessment's
                    strategy. Proposes candidate products + drafts a reply.
   Stage 4 VALIDATE (validator.js, separate call, no sales context):
                    verdict per candidate. SERVER ENFORCES the verdict.
   Stage 5 SELL     If everything passed: ship. If anything was rejected:
                    ONE repair call rewrites the reply without the rejected
                    products, using Melvin's handoff language for gaps.

   Benny can search freely. Benny can think freely.
   Benny is not allowed to SELL freely. Only validated products render.
   ===================================================================== */

/* ---------------- KNOWLEDGE (agent stage only) ---------------- */

function loadFile(f) {
  try { return fs.readFileSync(path.join(process.cwd(), "knowledge", f), "utf8"); }
  catch { return ""; }
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
  { k: ["drum", "percussion", "cymbal", "conga", "timbale"], f: ["drums.md", "percussion.md"] },
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

function loadKnowledge(messages) {
  const users = messages.filter(m => m.role === "user").map(m => String(m.content || ""));
  const latest = " " + (users[users.length - 1] || "").toLowerCase() + " ";
  const recent = " " + users.slice(-3).join(" ").toLowerCase() + " ";
  const files = new Set(CORE);
  let hit = false;
  for (const t of TOPICS) {
    if (t.k.some(k => latest.includes(k))) { t.f.forEach(f => files.add(f)); hit = true; }
  }
  if (!hit) for (const t of TOPICS) {
    if (t.k.some(k => recent.includes(k))) t.f.forEach(f => files.add(f));
  }
  return [...files].map(f => {
    const c = loadFile(f);
    return c ? "\n===== " + f + " =====\n" + c : "";
  }).join("\n");
}

/* ---------------- AGENT (SEARCH stage) PROMPT ---------------- */

function buildAgentPrompt(knowledge, assessment) {
  const stats = getCatalogStats();

  const assessmentBlock = assessment.failed ? "" : `
=====================================================================
YOUR PROFESSIONAL ASSESSMENT OF THIS CUSTOMER (produced before seeing
any products - your search and choices are HELD to this)
=====================================================================
NEED: ${assessment.need || "(not stated)"}
RISK FACTORS: ${JSON.stringify(assessment.risk_factors)}
MUST HAVE: ${JSON.stringify(assessment.must_have)}
AVOID (do not recommend these under any circumstance):
${JSON.stringify(assessment.avoid, null, 1)}
SUGGESTED SEARCHES: ${JSON.stringify(assessment.search_strategy)}
BRANDS THE CUSTOMER MENTIONED (you MUST call search_by_brand for each
before saying ANYTHING about whether we carry them):
${JSON.stringify(assessment.brands_mentioned)}

A separate fit inspector will review every product you propose against this
assessment. Products that violate the AVOID list will be stripped before the
customer sees them. Do not waste your recommendation on them.

CALIBRATION — READ CAREFULLY, THIS IS WHERE JUDGMENT LIVES:

UNKNOWN IS NOT A VIOLATION. A product fails an avoid-criterion only when you
have actual EVIDENCE it violates it — from its data or from what you genuinely
KNOW about that product line. Titles and descriptions rarely state things like
RF architecture, so "the title doesn't say diversity" is NOT a reason to
reject, and it is NEVER a reason to tell the customer we have nothing. Use
your real product knowledge: if you know a product line is frequency-agile or
diversity-equipped, that knowledge counts.

RECOMMEND THE BEST GENUINE FIT, HONESTLY FRAMED. When nothing is a certified
perfect match, show the strongest real candidates and say honestly what they
offer and where the team can take it further ("this line is frequency-
adjustable with antenna diversity — a solid choice for that environment; for
a fully coordinated professional setup, our team can spec the exact system").
An empty-handed handoff is the LAST resort, used only when nothing in the
category genuinely serves the need. Sending a customer to the phone with zero
products when good ones exist loses the sale.

CONFIGURATION GAPS ARE NOT INVENTORY GAPS. If they want one transmitter and we
stock the dual, say exactly that: show what we have, note the single version
is something the team can source. Never convert a variant/configuration
mismatch into "I'm not seeing anything."
`;

  return `
You are Benny, product advisor for Victory Musical Instruments. CONSULTANT
first, never a pushy salesperson. You are the FIRST STEP, not the whole
journey: you handle straightforward solutions and connect people with
Victory's expert team for anything custom.

Catalog: ${stats.sellable} sellable products. Reply in the customer's language.
${assessmentBlock}
=====================================================================
HOW YOU WORK
=====================================================================

Search per ROLE with product nouns ("wireless vocal system", "alto saxophone
reed"). Strength, size, finish, length live in VARIANTS, never in titles —
never put them in a query, and never claim we lack them without reading the
variants. If a search is empty, broaden and retry before concluding anything.

Every product you OFFER must come from a tool result. Never invent products,
prices, specs, SKUs, or stock. Judge every result: right instrument, right
brand if one was named, right category (a video switcher is not an audio
console; a lavalier is not a handheld wireless), right scale for the room,
right fit for the environment.

NEVER present your recommendation as the only or final answer. Offer the
range, mention we carry multiple brands, invite comparison. Especially for
microphones and instruments: fit is partly taste. A good rep never acts like
they've shown you everything.

If a budget was stated, the WHOLE system must fit it. Offer a phased build
when it can't.

=====================================================================
WHEN THE CATALOG DOESN'T HAVE IT
=====================================================================

Do NOT substitute the closest word-match. "We don't have it" is never the end:
say something like -

  "I'm not seeing the right option on the website, but we certainly have
   solutions. We've partnered with some of the top audio brands in the world.
   We have a strong, experienced team that can build a custom solution for
   you, and we'd love the chance to build it with you."

Then: ${PHONE} or ${EMAIL}. Never commit to a specific brand, model, or price
for something off-catalog - and never announce that limitation. Build
everything you legitimately CAN meanwhile.

=====================================================================
ABSOLUTE RULES
=====================================================================
- NEVER send a customer to another retailer. Ever.
- NEVER say "we don't sell/carry X." For brands: call search_by_brand FIRST.
  If it returns products, we carry the brand - say so and narrow down. Only
  after the catalog AND check_live_website are both empty may you say "I'm not
  seeing that in our catalog at the moment," then offer the team.
- NEVER claim to have added anything to the cart. You cannot. Say "just hit
  Add to Cart below."
- NEVER contradict the customer's terminology. Never pressure. Never argue
  with criticism - thank them and keep helping. NEVER close: no unprompted
  discounts or financing, no "what's stopping you today."
- Drafts: acknowledge they exist, route to the team, never price them.

=====================================================================
OUTPUT - ONE JSON OBJECT, NOTHING ELSE
=====================================================================
{
  "reply": "your message - warm, concise, in the customer's language",
  "products": [
    { "handle": "from-a-catalog-tool", "why": "why it fits THIS customer",
      "variant": "optional exact variant title, e.g. '2.5' or 'Soft (1.5-2.0)'" }
  ],
  "handoff": { "needed": true|false, "reason": "...", "subject": "email subject" }
}
Never write prices or URLs in "reply" - cards show them. Never mention a
product in "reply" without putting its handle in "products".

${knowledge}
`.trim();
}

/* ---------------- helpers ---------------- */

function parseJSON(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(t); } catch {
    const s = t.indexOf("{"), e = t.lastIndexOf("}");
    if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; } }
    return null;
  }
}

function buildMailto(subject, body) {
  return "mailto:" + EMAIL +
    "?subject=" + encodeURIComponent(subject || "Victory Musical Instruments Inquiry") +
    "&body=" + encodeURIComponent((body || "") + "\n\n---\nMy name:\nBest phone number:\nBest time to reach me:\n");
}

function isSellableRecord(p) {
  return p && p.sellable && typeof p.priceAmount === "number" && p.priceAmount > 0;
}

// Resolve a proposed product against catalog + verdicts + variant choice.
function resolveProducts(proposed, seenMap, verdicts) {
  const out = [];
  const stripped = [];
  const handled = new Set();

  for (const p of proposed || []) {
    if (!p || !p.handle || handled.has(p.handle)) continue;
    handled.add(p.handle);

    const candidate = seenMap.get(p.handle) || slim(findByHandle(p.handle));
    if (!isSellableRecord(candidate)) { stripped.push({ handle: p.handle, reason: "not sellable/priced" }); continue; }

    if (verdicts) {
      const v = verdicts.get(p.handle);
      if (v && v.verdict !== "accept") { stripped.push({ handle: p.handle, reason: v.verdict + ": " + v.reason }); continue; }
    }

    const item = { ...candidate, why: p.why || null };

    if (p.variant && Array.isArray(candidate.variants)) {
      const wanted = String(p.variant).trim().toLowerCase();
      const match = candidate.variants.find(v =>
        v && v.available && (
          String(v.title || "").trim().toLowerCase() === wanted ||
          (v.options || []).some(o => String(o.value || "").trim().toLowerCase() === wanted)
        )
      );
      if (match && match.addToCartUrl) {
        item.addToCartUrl = match.addToCartUrl;
        item.selectedVariant = (match.title && match.title !== "Default Title") ? match.title : null;
        if (typeof match.price === "number" && match.price > 0) {
          item.priceAmount = match.price;
          item.price = (candidate.currencyCode || "USD") + " " + match.price;
        }
      }
    }

    out.push(item);
  }
  return { products: out, stripped };
}

/* ---------------- THE ROUTE ---------------- */

const MAX_TOOL_ROUNDS = 8;

router.post("/", async (req, res) => {
  try {
    const { messages = [] } = req.body;

    // Empty-catalog safety net: never lie about inventory because WE are broken.
    const stats = getCatalogStats();
    if (!stats.sellable) {
      return res.json({
        reply: "I'm having trouble reaching our product catalog right now, so I don't want to " +
          "give you wrong information. Please call us at " + PHONE + " or email " + EMAIL +
          " and the team will take care of you right away.",
        recommendedProducts: [],
        handoff: { needed: true, reason: "catalog_unavailable", phone: PHONE, email: EMAIL,
                   mailto: buildMailto("Victory Musical Instruments Inquiry", "") },
        pipeline: { stage: "catalog_empty" },
        catalogStats: stats
      });
    }

    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const lastUserText = String(lastUser?.content || "");

    /* ---- STAGE 1: ASSESS ---- */
    const assessment = await runAssessment(messages);

    /* ---- STAGE 2: DISCOVER / CHAT — one fast call, no tools ---- */
    if ((assessment.mode === "discovery" || assessment.mode === "chat") && assessment.reply) {
      return res.json({
        reply: assessment.reply,
        recommendedProducts: [],
        handoff: { needed: false },
        pipeline: { stage: assessment.mode, assessment },
        catalogStats: stats
      });
    }

    /* ---- STAGE 3: SEARCH (agent loop with tools) ---- */
    const working = [
      { role: "system", content: buildAgentPrompt(loadKnowledge(messages), assessment) },
      ...messages
    ];

    const seen = new Map();       // sellable products retrieved from CATALOG tools this turn
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
      if (!calls.length) { final = msg; break; }

      for (const call of calls) {
        let args = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }

        const result = await executeTool(call.function.name, args);
        toolTrace.push({
          tool: call.function.name,
          spec: args.spec || null,
          query: args.query || args.brand || args.category || args.handle || null,
          found: result.found ?? result.products?.length ?? 0
        });

        if (call.function.name !== "check_live_website") {
          const add = p => { if (p && p.handle && p.sellable) seen.set(p.handle, p); };
          (result.products || []).forEach(add);
          if (result.product) add(result.product);
        }

        working.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
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

    let parsed = parseJSON(final?.content) || { reply: final?.content || "", products: [], handoff: { needed: false } };

    /* ---- STAGE 4: VALIDATE (consult mode only; simple lookups skip it) ---- */
    let verdicts = null;
    let validated = false;
    let strippedInfo = [];

    // Validator judges the FULL catalog record (findByHandle), not the slim
    // view the agent saw — the slim description is trimmed for token economy,
    // but the judge needs the whole stored description ("for RE3 handheld
    // transmitters" often sits deep in the text).
    const proposedCandidates = (parsed.products || [])
      .map(p => findByHandle(p.handle))
      .filter(isSellableRecord);

    if (assessment.mode === "consult" && !assessment.failed && proposedCandidates.length) {
      const v = await validateFit(assessment, lastUserText, proposedCandidates);
      if (v) { verdicts = v.verdicts; validated = true; }
      // v === null -> validator infra failure -> FAIL OPEN, flagged below.
    }

    /* ---- STAGE 5: SELL (with one repair pass if the validator caught something) ---- */
    let resolved = resolveProducts(parsed.products, seen, verdicts);
    strippedInfo = resolved.stripped;

    const validatorRejectedSomething =
      verdicts && resolved.stripped.some(s => s.reason.startsWith("reject") || s.reason.startsWith("needs_human"));

    if (validatorRejectedSomething) {
      // The reply text likely mentions products that just got stripped.
      // One repair call: rewrite around the verdicts. Server still enforces.
      const repair = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: [
          ...working,
          {
            role: "system",
            content:
              "A fit inspector reviewed your proposed products against your own assessment. " +
              "These were REJECTED and will NOT be shown to the customer:\n" +
              JSON.stringify(resolved.stripped, null, 1) + "\n" +
              "Rewrite your final JSON answer now. Do not mention or include rejected products. " +
              "Keep any accepted products. If a role is now unfilled, be honest in the customer's " +
              "language, keep the door open with the custom-solution handoff (" + PHONE + " / " + EMAIL + "), " +
              "and set handoff.needed=true. Do not call tools."
          }
        ],
        response_format: { type: "json_object" }
      });

      const repaired = parseJSON(repair.choices?.[0]?.message?.content);
      if (repaired && repaired.reply) {
        parsed = repaired;
        resolved = resolveProducts(parsed.products, seen, verdicts);
      }
    }

    const handoff = parsed?.handoff?.needed
      ? { needed: true, reason: parsed.handoff.reason || null, phone: PHONE, email: EMAIL,
          mailto: buildMailto(parsed.handoff.subject, parsed.reply) }
      : { needed: false };

    res.json({
      reply: parsed.reply || "",
      recommendedProducts: resolved.products,
      handoff,
      toolTrace,
      pipeline: {
        stage: "sell",
        mode: assessment.mode,
        assessment: assessment.failed ? { failed: true } : assessment,
        validated,                       // false = validator failed open; supervise these
        verdicts: verdicts ? [...verdicts.entries()].map(([h, v]) => ({ handle: h, ...v })) : null,
        stripped: strippedInfo
      },
      catalogStats: stats
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Benny encountered an error.", details: error.message });
  }
});

export default router;
