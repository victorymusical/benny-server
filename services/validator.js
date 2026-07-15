// validator.js — STAGE 4 of the pipeline: VALIDATE.
//
// A separate model call with a DIFFERENT JOB. It has no sales language, no
// tools, no incentive to close, and no knowledge files. It sees only:
//   - the customer's need and the assessment (risk factors, must/avoid)
//   - the candidate products Benny wants to sell (slim data)
// and returns a verdict per product: accept | reject | needs_human.
//
// THE VERDICT IS ENFORCED BY THE SERVER. A rejected product cannot render as
// a card no matter how fluently the sales agent rationalizes it. This is the
// answer to the "why field became rationalization" failure: justification
// after choosing is theater; a gate before selling is structure.
//
// Calibration matters in BOTH directions:
//   - False ACCEPT sells the wrong gear (the AKG-near-the-airport failure).
//   - False REJECT tells a customer we can't help when we can (the cardinal
//     sin). So: reject only for genuine mismatch with the stated need or a
//     named avoid-criterion — not for imperfection or "something better may
//     exist."
//
// FAIL-OPEN: if this call errors or times out, we return null and the caller
// proceeds without validation, flagged `validated:false` for supervision.
// An infrastructure hiccup must never become a false "we don't have it."

import client from "./openai.js";
import { MODELS, chatComplete } from "./models.js";

const VALIDATOR_PROMPT = `
You are a fit inspector for a music/pro-audio retailer. You are NOT a
salesperson. You do not care whether a sale happens. Your only job: does each
candidate product genuinely fit the customer's stated need?

You will receive the customer's need, a professional assessment (risk factors,
must-haves, things to avoid), and candidate products (title, brand, type,
price, variant options).

For EACH candidate return a verdict:

- "accept": the product genuinely serves the stated need and violates no
  avoid-criterion. Products don't need to be perfect - a solid, honest fit is
  an accept. Do NOT reject merely because something better might exist.
- "reject": ONLY when you have positive EVIDENCE the product does not serve
  the need (wrong category, wrong instrument, wrong scale) or that it matches
  a named avoid-criterion. Evidence means its data, or what you genuinely KNOW
  about that specific product line (e.g. you know the AKG WMS40 Mini is a
  fixed-frequency single-antenna system). ABSENCE of information is NOT
  evidence: titles and descriptions rarely state RF architecture, wattage
  details, or build specifics. "The title doesn't mention diversity" is never
  grounds for rejection. When the data is silent and your own knowledge of the
  product line suggests it fits, accept.
- "needs_human": genuine uncertainty a professional should resolve
  (borderline scale, compatibility unknown even to you, undersized for the
  room). Use this sparingly - it removes the product from the sale.

Remember the two failure costs: accepting a true misfit sells wrong gear, but
rejecting on missing paperwork strands a customer who could have been served.
Both are failures. Judge like a knowledgeable colleague, not a compliance
officer.

Judge by what the product IS (its type, its nature, its DESCRIPTION), not by
how its title is worded. A "Live Streaming Mixer (HDMI)" is a video switcher
regardless of the word "mixer". A desktop mic stand is not a floor stand. A
baritone reed is not an alto reed. An entry fixed-frequency wireless system is
not a congested-RF solution.

COMPONENT PROTECTION: when the customer needs a complete working solution, a
COMPONENT cannot be accepted as that solution. Capsule heads, replacement
heads, transmitter-only, receiver-only, mounts, adapters, cables, and
accessories are components. Reject them for a complete-system role (reason:
"component, not a complete system") unless the customer specifically asked for
that component. Description phrases like "for ... transmitters", "replacement",
"capsule", "receiver sold separately", "requires ..." are component evidence.

DO NOT INFER FIT FROM CATEGORY ADJACENCY:
- microphone-related does not mean it fits an instrument-microphone role
- wireless-related does not mean it is a complete wireless system
- sax-related does not mean it fits every saxophone (soprano ≠ alto ≠ tenor)
- a "head" or "capsule" is not a complete microphone

Return ONLY JSON, no fences:
{
  "verdicts": [
    { "handle": "...", "verdict": "accept" | "reject" | "needs_human",
      "reason": "one plain sentence" }
  ]
}
Every candidate handle must appear exactly once.
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

// Trim candidates to what fit-judgment needs. No cart URLs, no images —
// the validator judges fit, it doesn't sell. The DESCRIPTION is essential:
// it's where a product admits what it actually is ("capsule head for RE3
// handheld transmitters"), which the title never says.
function forJudgment(p) {
  return {
    handle: p.handle,
    title: p.title,
    brand: p.vendor,
    productType: p.productType,
    description: (p.description || "").slice(0, 900),
    price: p.priceAmount,
    options: (p.options || []).map(o => `${o.name}: ${(o.values || []).join("/")}`)
  };
}


export async function validateFit(assessment, customerText, candidates) {
  if (!candidates || !candidates.length) return { verdicts: new Map(), validated: true };

  try {
    const payload = {
      customer_request: customerText,
      need: assessment.need,
      risk_factors: assessment.risk_factors,
      must_have: assessment.must_have,
      avoid: assessment.avoid,
      candidates: candidates.map(forJudgment)
    };

    const response = await chatComplete(client, {
      model: MODELS.validator,
      temperature: 0,
      max_tokens: 900,
      messages: [
        { role: "system", content: VALIDATOR_PROMPT },
        { role: "user", content: JSON.stringify(payload) }
      ],
      response_format: { type: "json_object" }
    });

    const parsed = parseJSON(response.choices?.[0]?.message?.content);
    if (!parsed || !Array.isArray(parsed.verdicts)) {
      console.warn("Validator returned unparseable output; failing open.");
      return null;
    }

    const verdicts = new Map();
    for (const v of parsed.verdicts) {
      if (v && v.handle) {
        verdicts.set(v.handle, {
          verdict: ["accept", "reject", "needs_human"].includes(v.verdict) ? v.verdict : "needs_human",
          reason: v.reason || ""
        });
      }
    }

    // Any candidate the validator forgot: fail open PER PRODUCT (accept),
    // because silence is not evidence of unfitness.
    for (const c of candidates) {
      if (!verdicts.has(c.handle)) {
        verdicts.set(c.handle, { verdict: "accept", reason: "not evaluated (fail-open)" });
      }
    }

    return { verdicts, validated: true };
  } catch (err) {
    console.warn("Validator call failed; failing open:", err.message);
    return null; // caller proceeds unvalidated, flagged for supervision
  }
}
