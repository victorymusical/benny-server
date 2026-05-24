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

function detectProduct(text) {
  const normalized = normalizeText(text);

  const productRules = [
    {
      product: "Bricasti M7",
      terms: ["bricasti m7", "m7"]
    },
    {
      product: "Bricasti M10",
      terms: ["bricasti m10", "m10"]
    },
    {
      product: "Apollo x4",
      terms: ["apollo x4", "x4"]
    },
    {
      product: "Apollo Twin",
      terms: ["apollo twin", "twin x", "apollo twin x"]
    },
    {
      product: "Apollo Solo",
      terms: ["apollo solo", "solo"]
    },
    {
      product: "Apollo x6",
      terms: ["apollo x6", "x6"]
    },
    {
      product: "Apollo x8",
      terms: ["apollo x8", "x8"]
    },
    {
      product: "Apollo x16",
      terms: ["apollo x16", "x16"]
    },
    {
      product: "Volt 1",
      terms: ["volt 1"]
    },
    {
      product: "Volt 2",
      terms: ["volt 2"]
    },
    {
      product: "Volt 176",
      terms: ["volt 176"]
    },
    {
      product: "Volt 276",
      terms: ["volt 276"]
    },
    {
      product: "Volt 476",
      terms: ["volt 476"]
    },
    {
      product: "Volt 876",
      terms: ["volt 876"]
    },
    {
      product: "StreamPath SP33CM",
      terms: ["sp33cm", "streamPath sp33cm", "streampath sp33cm"]
    },
    {
      product: "StreamPath SP32CM",
      terms: ["sp32cm", "streamPath sp32cm", "streampath sp32cm"]
    },
    {
      product: "StreamPath SP31DM",
      terms: ["sp31dm", "streamPath sp31dm", "streampath sp31dm"]
    },
    {
      product: "StreamPath HC40",
      terms: ["hc40", "streamPath hc40", "streampath hc40"]
    },
    {
      product: "StreamPath HC50",
      terms: ["hc50", "streamPath hc50", "streampath hc50"]
    },
    {
      product: "StreamPath HM90",
      terms: ["hm90", "streamPath hm90", "streampath hm90"]
    },
    {
      product: "UA Bock 251",
      terms: ["bock 251", "ua bock 251"]
    },
    {
      product: "Shure SM58",
      terms: ["sm58", "shure sm58"]
    },
    {
      product: "Shure PG58",
      terms: ["pg58", "shure pg58"]
    }
  ];

  for (const rule of productRules) {
    if (rule.terms.some(term => normalized.includes(term.toLowerCase()))) {
      return rule.product;
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
    normalized.includes("promotions") ||
    normalized.includes("promo") ||
    normalized.includes("sale") ||
    normalized.includes("offer")
  ) {
    return "pricing_question";
  }

  if (
    normalized.includes("link") ||
    normalized.includes("url") ||
    normalized.includes("page") ||
    normalized.includes("where can i see") ||
    normalized.includes("send me")
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
    .map(m => String(m.content || ""))
    .join(" ");

  const normalizedLastMessage = normalizeText(lastUserMessage);
  const normalizedFullText = normalizeText(fullConversationText);

  const intent = detectIntent(lastUserMessage);

  const brandMentioned =
    detectBrand(lastUserMessage) || detectBrand(fullConversationText);

  const categoryMentioned =
    detectCategory(lastUserMessage) || detectCategory(fullConversationText);

  let productMentioned =
    detectProduct(lastUserMessage) || detectProduct(fullConversationText);

  if (
    normalizedFullText.includes("bricasti") &&
    normalizedLastMessage.includes("m7")
  ) {
    productMentioned = "Bricasti M7";
  }

  if (
    normalizedFullText.includes("bricasti") &&
    normalizedLastMessage.includes("m10")
  ) {
    productMentioned = "Bricasti M10";
  }

  if (
    normalizedFullText.includes("apollo") &&
    normalizedLastMessage.includes("x4")
  ) {
    productMentioned = "Apollo x4";
  }

  return {
    intent,
    lastUserMessage,
    brandMentioned,
    categoryMentioned,
    specificProductMentioned: productMentioned,
    needsPrice: intent === "pricing_question",
    needsLink: intent === "link_request",
    needsQuote: intent === "quote_request",
    needsBrandList: intent === "brand_lookup",
    needsCompatibility: intent === "compatibility_question"
  };
}
