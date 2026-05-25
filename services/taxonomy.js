function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

export const TAXONOMY = {
  "Euphoniums": {
    canonicalCategory: "Euphoniums",
    collectionHandle: "euphonium",
    aliases: [
      "euphonium",
      "euphoniums",
      "bombardino",
      "bombardinos",
      "baritone",
      "baritono",
      "baritone horn"
    ],
    productTypeHints: [
      "euphonium",
      "baritone"
    ],
    excludeAccessoryTerms: [
      "case",
      "bag",
      "mouthpiece",
      "cleaning",
      "stand",
      "valve oil"
    ]
  },

  "Video Switchers": {
    canonicalCategory: "Video Switchers",
    collectionHandle: "blackmagic-design",
    aliases: [
      "video switcher",
      "switcher",
      "atem",
      "blackmagic",
      "blackmagic design",
      "broadcast switcher",
      "live production switcher",
      "production switcher"
    ],
    productTypeHints: [
      "switcher",
      "live production switcher",
      "video switcher",
      "atem"
    ],
    excludeAccessoryTerms: [
      "cable",
      "adapter",
      "case",
      "mount",
      "battery",
      "power supply"
    ]
  },

  "Saxophones": {
    canonicalCategory: "Saxophones",
    collectionHandle: "saxophones",
    aliases: [
      "saxophone",
      "saxophones",
      "sax",
      "alto sax",
      "alto saxophone",
      "tenor sax",
      "tenor saxophone",
      "soprano sax",
      "soprano saxophone",
      "baritone sax",
      "baritone saxophone"
    ],
    productTypeHints: [
      "saxophone",
      "alto saxophone",
      "tenor saxophone",
      "soprano saxophone",
      "baritone saxophone"
    ],
    excludeAccessoryTerms: [
      "mouthpiece",
      "reed",
      "ligature",
      "case",
      "strap",
      "stand",
      "cleaning",
      "neck",
      "pad"
    ]
  },

  "Trumpets": {
    canonicalCategory: "Trumpets",
    collectionHandle: "trumpets",
    aliases: [
      "trumpet",
      "trumpets",
      "bb trumpet",
      "c trumpet",
      "piccolo trumpet"
    ],
    productTypeHints: [
      "trumpet",
      "piccolo trumpet"
    ],
    excludeAccessoryTerms: [
      "mouthpiece",
      "case",
      "valve oil",
      "stand",
      "cleaning",
      "mute"
    ]
  },

  "Trombones": {
    canonicalCategory: "Trombones",
    collectionHandle: "trombones",
    aliases: [
      "trombone",
      "trombones",
      "f attachment trombone",
      "trigger trombone"
    ],
    productTypeHints: [
      "trombone"
    ],
    excludeAccessoryTerms: [
      "case",
      "mouthpiece",
      "slide oil",
      "slide grease",
      "stand",
      "cleaning",
      "mute"
    ]
  },

  "Guitars": {
    canonicalCategory: "Guitars",
    collectionHandle: "guitars",
    aliases: [
      "guitar",
      "guitars",
      "electric guitar",
      "acoustic guitar",
      "classical guitar",
      "acoustic electric guitar"
    ],
    productTypeHints: [
      "guitar",
      "electric guitar",
      "acoustic guitar",
      "classical guitar"
    ],
    excludeAccessoryTerms: [
      "cable",
      "strings",
      "case",
      "strap",
      "stand",
      "pick",
      "capo",
      "tuner",
      "adapter"
    ]
  },

  "Microphones": {
    canonicalCategory: "Microphones",
    collectionHandle: "microphones",
    aliases: [
      "microphone",
      "microphones",
      "mic",
      "mics",
      "condenser",
      "condenser microphone",
      "dynamic microphone",
      "studio mic",
      "vocal mic",
      "wireless mic"
    ],
    productTypeHints: [
      "microphone",
      "condenser microphone",
      "dynamic microphone",
      "wireless microphone"
    ],
    excludeAccessoryTerms: [
      "stand",
      "cable",
      "clip",
      "shock mount",
      "pop filter",
      "case",
      "adapter"
    ]
  },

  "Audio Interfaces": {
    canonicalCategory: "Audio Interfaces",
    collectionHandle: "audio-interfaces",
    aliases: [
      "audio interface",
      "audio interfaces",
      "recording interface",
      "sound interface",
      "sound card",
      "usb interface",
      "apollo",
      "volt",
      "irig"
    ],
    productTypeHints: [
      "audio interface",
      "recording interface",
      "interface"
    ],
    excludeAccessoryTerms: [
      "cable",
      "adapter",
      "case",
      "power supply"
    ]
  },

  "Cables": {
    canonicalCategory: "Cables",
    collectionHandle: "cables",
    aliases: [
      "cable",
      "cables",
      "xlr",
      "xlr cable",
      "trs cable",
      "instrument cable",
      "speaker cable",
      "usb cable",
      "hdmi cable",
      "sdi cable",
      "ethernet cable"
    ],
    productTypeHints: [
      "cable",
      "adapter"
    ],
    excludeAccessoryTerms: []
  }
};

export function findTaxonomyCategory(input = "") {
  const normalizedInput = normalize(input);

  for (const [key, config] of Object.entries(TAXONOMY)) {
    const terms = [
      key,
      config.canonicalCategory,
      ...(config.aliases || [])
    ];

    const match = terms.some(term => {
      const normalizedTerm = normalize(term);
      return normalizedInput.includes(normalizedTerm);
    });

    if (match) {
      return {
        key,
        ...config
      };
    }
  }

  return null;
}

export function buildTaxonomySearchQueries(intentData = {}) {
  const queries = [];

  const items = intentData.requestedItems || [];

  for (const item of items) {
    const rawText = [
      item.brand,
      item.product,
      item.category,
      item.searchQuery
    ]
      .filter(Boolean)
      .join(" ");

    const taxonomyMatch = findTaxonomyCategory(rawText);

    if (taxonomyMatch) {
      queries.push({
        requestedItem: item,
        taxonomyCategory: taxonomyMatch.canonicalCategory,
        collectionHandle: taxonomyMatch.collectionHandle,
        searchQueries: [
          item.searchQuery,
          item.product,
          item.category,
          taxonomyMatch.canonicalCategory,
          ...(taxonomyMatch.aliases || []).slice(0, 5)
        ].filter(Boolean)
      });
    } else {
      queries.push({
        requestedItem: item,
        taxonomyCategory: item.category || null,
        collectionHandle: null,
        searchQueries: [
          item.searchQuery,
          [item.brand, item.product, item.category].filter(Boolean).join(" ")
        ].filter(Boolean)
      });
    }
  }

  return queries;
}

export function normalizeText(value = "") {
  return normalize(value);
}
