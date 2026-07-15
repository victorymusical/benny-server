// models.js — central model configuration. GUARD THE CART, NOT THE BRAIN.
//
// Every stage's model is a Railway environment variable, not a hardcoded
// string. Point the advisor at the strongest model available; reserve cheap
// models for non-critical work. Defaults are safe, known-good models — set
// the env vars to whatever OpenAI currently offers.
//
// Railway variables (all optional):
//   BENNY_MAIN_MODEL       main advisor / agent loop / repair pass
//   BENNY_ASSESS_MODEL     stage-1 assessment (professional situational read)
//   BENNY_VALIDATOR_MODEL  stage-4 fit inspector
//   BENNY_FAST_MODEL       reserved for simple non-critical tasks
//   BENNY_EMBEDDING_MODEL  reserved for semantic retrieval (next build)

export const MODELS = {
  main: process.env.BENNY_MAIN_MODEL || "gpt-4.1",
  assess: process.env.BENNY_ASSESS_MODEL || "gpt-4.1",
  validator: process.env.BENNY_VALIDATOR_MODEL || "gpt-4.1",
  fast: process.env.BENNY_FAST_MODEL || "gpt-4.1-mini",
  embedding: process.env.BENNY_EMBEDDING_MODEL || "text-embedding-3-small"
};

export function logModelConfig() {
  console.log("Benny model configuration:");
  console.log(`  assessment : ${MODELS.assess}`);
  console.log(`  main advisor: ${MODELS.main}`);
  console.log(`  validator  : ${MODELS.validator}`);
  console.log(`  fast       : ${MODELS.fast} (reserved)`);
  console.log(`  embeddings : ${MODELS.embedding} (reserved for semantic retrieval)`);
}

// Tolerant model call. Newer reasoning models reject some Chat Completions
// parameters (temperature; max_tokens renamed max_completion_tokens). Rather
// than crash when a stage is pointed at a newer model, strip/rename the
// offending parameter and retry — so switching models in Railway never
// requires a code change.
export async function chatComplete(client, params) {
  let attempt = { ...params };

  for (let tries = 0; tries < 3; tries++) {
    try {
      return await client.chat.completions.create(attempt);
    } catch (err) {
      const msg = String(err?.message || "");

      if (/temperature/i.test(msg) && "temperature" in attempt) {
        console.warn(`[models] ${attempt.model} rejected temperature — retrying without it.`);
        const { temperature, ...rest } = attempt;
        attempt = rest;
        continue;
      }
      if (/max_tokens/i.test(msg) && "max_tokens" in attempt) {
        console.warn(`[models] ${attempt.model} wants max_completion_tokens — renaming.`);
        const { max_tokens, ...rest } = attempt;
        attempt = { ...rest, max_completion_tokens: max_tokens };
        continue;
      }
      throw err;
    }
  }
  throw new Error("chatComplete: exhausted parameter-compatibility retries");
}
