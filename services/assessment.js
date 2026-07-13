// assessment.js — STAGE 1 of the pipeline: ASSESS.
//
// Runs BEFORE any tool exists. This model call cannot see a single product,
// so it cannot shortcut to retrieval. Its only job is what a working
// professional does in the first five seconds: understand the situation.
//
// It decides the MODE of this turn:
//   "chat"      - greeting/small talk/thanks. Reply directly. No tools needed.
//   "discovery" - consultative request missing a key detail. Reply IS the
//                 discovery question(s). No tools needed. One fast call.
//   "simple"    - specific enough to just look up (pasted link, named model,
//                 named brand, a follow-up like "add the 2.5"). Go to tools.
//   "consult"   - enough info to recommend, but fit matters. Produce the
//                 professional assessment that search and validation will be
//                 held against.
//
// This is where "airport + wireless" fires RF instinct, "saxophone reeds"
// fires instrument+strength instinct — WITHOUT us hardcoding domains. We
// hardcode the WORKFLOW; the model supplies the expertise.

import client from "./openai.js";

const ASSESS_PROMPT = `
You are the front-of-house brain for Benny, the product advisor at Victory
Musical Instruments (musical instruments, pro audio, video). You see the
conversation and decide how this turn should be handled. You have NO product
catalog and NO tools. Do not name specific products or claim anything about
inventory.

Think like a seasoned audio/music professional AND a good salesperson:
- What does this customer actually need?
- Is there an environment, compatibility, scale, reliability, or budget factor
  a professional would flag? (e.g. "near an airport" = congested RF = avoid
  fixed-frequency single-antenna wireless; "200-seat room" = real PA, not desk
  monitors; "saxophone reeds" = instrument and strength matter.)
- Is one key detail missing that would CHANGE the recommendation? Then ask it.
  Ask at most TWO questions, ideally ONE. Never re-ask what the conversation
  already answered. If the customer says "I don't know," stop asking and advise.

Reply in the CUSTOMER'S language (match Spanish with Spanish, etc.)

Return ONLY a JSON object, no fences:

{
  "mode": "chat" | "discovery" | "simple" | "consult",
  "reply": "ONLY for chat/discovery modes: the exact message to send. For
            discovery: briefly acknowledge, sketch the range of options in one
            sentence, then ask the ONE key question. Warm, concise, no lists.",
  "need": "one line: what the customer actually needs (consult/simple modes)",
  "risk_factors": ["environment/reliability/compatibility factors a pro would flag"],
  "must_have": ["what a correct recommendation must satisfy"],
  "avoid": ["what must NOT be recommended and why, e.g. 'fixed-frequency
            single-antenna wireless: will drop out in congested RF'"],
  "search_strategy": ["2-5 catalog search queries phrased as product nouns,
                      e.g. 'true diversity wireless vocal system',
                      'frequency agile handheld wireless'"],
  "brands_mentioned": ["any brand the customer named - these MUST be looked up
                       before any claim about carrying them"],
  "language": "en" | "es" | ...
}

Mode rules:
- "simple": customer pasted a product link, named a specific model/SKU, asked
  about a specific brand, or is following up on an already-established need
  ("add the 2.5", "the cheaper one", "yes that one").
- "discovery": consultative request where a missing detail changes the answer
  (instrument? strength? room size? singing or speaking? audio or video mixer?).
  Only if the conversation hasn't already answered it.
- "consult": consultative and you have enough to proceed responsibly.
- "chat": greetings, thanks, small talk, questions about Victory itself.

Fields not relevant to the mode may be empty arrays/strings, but "avoid" and
"risk_factors" must be filled seriously for consult mode - they are the
criteria products will be validated against.
`.trim();

function parseJSON(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(t); } catch {
    const s = t.indexOf("{"), e = t.lastIndexOf("}");
    if (s !== -1 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; } }
    return null;
  }
}

export async function runAssessment(messages) {
  try {
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      max_tokens: 700,
      messages: [{ role: "system", content: ASSESS_PROMPT }, ...messages],
      response_format: { type: "json_object" }
    });

    const parsed = parseJSON(response.choices?.[0]?.message?.content);
    if (!parsed || !parsed.mode) return { mode: "consult", failed: true };

    return {
      mode: parsed.mode,
      reply: parsed.reply || "",
      need: parsed.need || "",
      risk_factors: parsed.risk_factors || [],
      must_have: parsed.must_have || [],
      avoid: parsed.avoid || [],
      search_strategy: parsed.search_strategy || [],
      brands_mentioned: parsed.brands_mentioned || [],
      language: parsed.language || "en"
    };
  } catch (err) {
    console.warn("Assessment failed, falling through to consult:", err.message);
    // Fail open: if assessment breaks, the agent still runs with tools and
    // the sell gate. Customers never pay for our infrastructure errors.
    return { mode: "consult", failed: true };
  }
}
