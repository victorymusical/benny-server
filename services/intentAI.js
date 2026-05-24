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
- accessories
- whether the customer is asking for price, link, quote, financing, compatibility, or product recommendation

Correct spelling when obvious.
Example:
"universa audio x8" means "Universal Audio Apollo x8".

Accessory completion is important. If the customer asks about cables, adapters, cases, mouthpieces, reeds, stands, mounts, batteries, power supplies, memory cards, tripods, or accessories, include them as requestedItems. Do not treat accessories as casual conversation.

If the customer asks what sizes, lengths, or options are available for a previously discussed accessory, infer the accessory from conversation context.
Example:
If the conversation was about XLR cables and the customer asks “what sizes do you have?” or “which one do you have, 10 or 15?”, the requested item should be XLR cables.

If the customer is building a setup and asks about proper cables, infer the likely cable type from the connected products when possible.
Example:
Bricasti M7 + Universal Audio Apollo x8 usually requires balanced analog cables. If unsure, use a searchQuery that includes the likely connector and the word cable.

Use these broad categories when possible:
- Audio Interfaces
- Microphones
- Headphones
- Studio Monitors
- Reverb and Effects
- Cables
- Adapters
- Stands and Mounts
- Cases and Bags
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

If the customer asks to build a cart, quote, setup, system, bundle, or rig, include the main products and needed accessories in requestedItems.

Example:
Customer conversation:
“I need a Bricasti M7 and Apollo x8 with the proper cables.”
“What sizes do you have? 10 or 15?”

Return:
{
  "intent": "product_recommendation",
  "needsPrice": true,
  "needsLink": true,
  "needsQuote": true,
  "needsFinancing": false,
  "needsCompatibility": true,
  "requestedItems": [
    {
      "brand": "Bricasti",
      "product": "M7",
      "category": "Reverb and Effects",
      "searchQuery": "Bricasti M7"
    },
    {
      "brand": "Universal Audio",
      "product": "Apollo x8",
      "category": "Audio Interfaces",
      "searchQuery": "Universal Audio Apollo x8"
    },
    {
      "brand": null,
      "product": "balanced XLR cables",
      "category": "Cables",
      "searchQuery": "XLR cable 10 ft 15 ft"
    }
  ]
}

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
