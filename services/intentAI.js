import client from "./openai.js";

export async function classifyIntentWithAI(messages = []) {
  const userConversation = messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join("\n");

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
You are an intent parser for an ecommerce music, audio, and video store.

Return ONLY valid JSON. Do not explain anything.

Your job is to identify:
- customer intent
- requested products
- brands
- categories
- whether the customer is asking for price, link, quote, financing, compatibility, or product recommendation

Correct spelling when obvious.
Example:
"universa audio x8" means "Universal Audio Apollo x8".

Use these broad categories when possible:
- Audio Interfaces
- Microphones
- Headphones
- Studio Monitors
- Reverb and Effects
- Cables
- Saxophones
- Trumpets
- Trombones
- Clarinets
- Flutes
- Guitars
- Keyboards and Pianos
- PTZ Cameras
- Video Production
- Drums and Percussion

If the customer mentions more than one product, include all of them in requestedItems.

Return JSON in this exact shape:

{
  "intent": "product_recommendation | pricing_question | link_request | brand_lookup | availability_question | compatibility_question | comparison_question | quote_request | financing_question",
  "needsPrice": true/false,
  "needsLink": true/false,
  "needsQuote": true/false,
  "needsFinancing": true/false,
  "needsCompatibility": true/false,
  "requestedItems": [
    {
      "brand": "string or null",
      "product": "string or null",
      "category": "string or null",
      "searchQuery": "best Shopify search phrase for this item"
    }
  ]
}
`
      },
      {
        role: "user",
        content: userConversation
      }
    ]
  });

  const raw = response.choices[0].message.content;

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("Intent AI JSON parse failed:", raw);

    return {
      intent: "product_recommendation",
      needsPrice: false,
      needsLink: false,
      needsQuote: false,
      needsFinancing: false,
      needsCompatibility: false,
      requestedItems: []
    };
  }
}
