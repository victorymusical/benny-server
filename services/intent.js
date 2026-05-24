function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .trim();
}

function getLastUserMessage(messages = []) {
  return (
    messages
      .filter(m => m.role === "user")
      .slice(-1)[0]?.content || ""
  );
}

function detectBrand(text) {
  const brands = [
    "Universal Audio",
    "UA",
    "IK Multimedia",
    "ESI",
    "StreamPath",
    "Victory",
    "The Growling Sax",
    "Bricasti",
    "Shure",
    "AKG",
    "Blackmagic",
    "OBSBOT",
    "Kurzweil",
    "Artesia",
    "Alto Professional",
    "Hosa"
  ];

  const normalized = normalizeText(text);

  for (const brand of brands) {
    const brandLower = brand.toLowerCase();

    if (normalized.includes(brandLower)) {
      return brand;
    }

    if (brand === "Universal Audio" && normalized.includes("apollo")) {
      return "Universal Audio";
    }

    if (brand === "Universal Audio" && normalized.includes("uad")) {
      return "Universal Audio";
    }

    if (brand === "The Growling Sax" && normalized.includes("growling sax")) {
      return "The Growling Sax";
    }
  }

  return null;
}

function detectCategory(text) {
  const normalized = normalizeText(text);

  const categoryRules = [
    {
      category: "Audio Interfaces",
      terms: [
        "audio interface",
        "recording interface",
        "sound interface",
        "sound card",
        "usb interface",
        "apollo",
        "volt",
        "irig",
        "interface for vocals",
        "interface for guitar"
      ]
    },
    {
      category: "Microphones",
      terms: [
        "microphone",
        "mic",
        "studio mic",
        "condenser",
        "dynamic mic",
        "vocal mic",
        "recording mic",
        "wireless mic"
      ]
    },
    {
      category: "Headphones",
      terms: [
        "headphones",
        "studio headphones",
        "monitoring headphones",
        "closed back",
        "closed-back",
        "in ear",
        "earphones"
      ]
    },
    {
      category: "Saxophones",
      terms: [
        "saxophone",
        "sax",
        "alto sax",
        "tenor sax",
        "soprano sax",
        "baritone sax"
      ]
    },
    {
      category: "Trumpets",
      terms: ["trumpet"]
    },
    {
      category: "Trombones",
      terms: ["trombone"]
    },
    {
      category: "Clarinets",
      terms: ["clarinet"]
    },
    {
      category: "Flutes",
      terms: ["flute", "piccolo"]
    },
    {
      category: "Guitars",
      terms: [
        "guitar",
        "electric guitar",
        "acoustic guitar",
        "classical guitar",
        "bass guitar"
      ]
    },
    {
      category: "Keyboards and Pianos",
      terms: [
        "keyboard",
        "piano",
        "stage piano",
        "digital piano",
        "synthesizer",
        "workstation"
      ]
    },
    {
      category: "PTZ Cameras",
      terms: [
        "ptz",
        "ptz camera",
        "church camera",
        "streaming camera"
      ]
    },
    {
      category: "Video Production",
      terms: [
        "video switcher",
        "capture card",
        "live streaming",
        "streaming setup",
        "blackmagic",
        "obsbot",
        "camera"
      ]
    },
    {
      category: "Reverb and Effects",
      terms: [
        "bricasti",
        "reverb",
        "effects processor",
        "processor"
      ]
    },
    {
      category: "Cables",
      terms: [
        "cable",
        "cables",
        "xlr",
        "trs",
        "patch cable",
        "instrument cable",
        "speaker cable"
      ]
    }
  ];

  for (const rule of categoryRules) {
    if (rule.terms.some(term => normalized.includes(term))) {
      return rule.category;
    }
  }

  return null;
}

function detectSpecificProduct(text) {
  const normalized = normalizeText(text);

  const productPatterns = [
    "apollo x4",
    "apollo twin",
    "apollo solo",
    "apollo x6",
    "apollo x8",
    "apollo x16",
    "volt 1",
    "volt 2",
    "volt 176",
    "volt 276",
    "volt 476",
    "volt 876",
    "sp33cm",
    "sp32cm",
    "sp31dm",
    "hc40",
    "hc50",
    "hm90",
    "bricasti m7",
    "bricasti m10",
    "bock 251",
    "sm58",
    "pg58"
  ];

  for (const product of productPatterns) {
    if (normalized.includes(product)) {
      return product;
    }
  }

  return null;
}

function detectIntent(text) {
  const normalized = normalizeText(text);

  if (
    normalized.includes("add to quote") ||
    normalized.includes("add it to my quote") ||
    normalized.includes("quote") ||
    normalized.includes("build this cart") ||
    normalized.includes("add to cart")
  ) {
    return "quote_request";
  }

  if (
    normalized.includes("price") ||
    normalized.includes("how much") ||
    normalized.includes("cost") ||
    normalized.includes("discount") ||
    normalized.includes("promotion") ||
    normalized.includes("promo") ||
    normalized.includes("sale")
  ) {
    return "pricing_question";
  }

  if (
    normalized.includes("link") ||
    normalized.includes("url") ||
    normalized.includes("page")
  ) {
    return "link_request";
  }

  if (
    normalized.includes("what brands") ||
    normalized.includes("which brands") ||
    normalized.includes("how many brands") ||
    normalized.includes("brands do you carry") ||
    normalized.includes("brands do you sell") ||
    normalized.includes("brands do you offer")
  ) {
    return "brand_lookup";
  }

  if (
    normalized.includes("do you have") ||
    normalized.includes("do you carry") ||
    normalized.includes("do you sell")
  ) {
    return "availability_question";
  }

  if (
    normalized.includes("connect") ||
    normalized.includes("compatible") ||
    normalized.includes("work with") ||
    normalized.includes("cabling") ||
    normalized.includes("cables do i need") ||
    normalized.includes("how should it be connected")
  ) {
    return "compatibility_question";
  }

  if (
    normalized.includes("difference") ||
    normalized.includes("compare") ||
    normalized.includes("versus") ||
    normalized.includes("vs")
  ) {
    return "comparison_question";
  }

  return "product_recommendation";
}

export function classifyIntent(messages = []) {
  const lastUserMessage = getLastUserMessage(messages);

  const fullConversationText = messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join(" ");

  const intent = detectIntent(lastUserMessage);
  const brandMentioned =
    detectBrand(lastUserMessage) || detectBrand(fullConversationText);

  const categoryMentioned =
    detectCategory(lastUserMessage) || detectCategory(fullConversationText);

  const specificProductMentioned =
    detectSpecificProduct(lastUserMessage) || detectSpecificProduct(fullConversationText);

  return {
    intent,
    lastUserMessage,
    brandMentioned,
    categoryMentioned,
    specificProductMentioned,
    needsPrice:
      intent === "pricing_question",
    needsLink:
      intent === "link_request",
    needsQuote:
      intent === "quote_request",
    needsBrandList:
      intent === "brand_lookup",
    needsCompatibility:
      intent === "compatibility_question"
  };
}
