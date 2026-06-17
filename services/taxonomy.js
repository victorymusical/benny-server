// taxonomy.js
//
// What changed in v1:
// 1. The taxonomy is no longer a gate. If a category is missing here, products
//    are still treated as real candidates downstream. Nothing gets hidden.
// 2. Category matching now picks the LONGEST matching phrase across all
//    categories instead of the first one in object order. This fixes bugs like
//    "baritone saxophone" being sent to the euphonium collection.
// 3. More categories were added so scoring is smarter, but this list does NOT
//    need to be complete to work. Missing categories are harmless now.
//
// collectionHandle values are best guesses. They are informational for now and
// are NOT used to run searches yet, so a wrong handle will not break anything.
// We will wire real collection search in a later version.

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Whole-phrase match so short words do not match inside larger words.
function phraseInText(text, phrase) {
  const t = normalize(text);
  const p = normalize(phrase);
  if (!t || !p) return false;
  const pattern = new RegExp(`(^| )${p.replace(/ /g, " ")}( |$)`);
  return pattern.test(t);
}

export const TAXONOMY = {
  // ---------- WOODWINDS ----------
  "Saxophones": {
    canonicalCategory: "Saxophones",
    collectionHandle: "saxophones",
    aliases: [
      "saxophone", "saxophones", "sax",
      "alto sax", "alto saxophone",
      "tenor sax", "tenor saxophone",
      "soprano sax", "soprano saxophone",
      "baritone sax", "baritone saxophone", "bari sax"
    ],
    productTypeHints: ["saxophone"],
    excludeAccessoryTerms: ["mouthpiece", "reed", "ligature", "case", "strap", "stand", "cleaning", "neck strap", "pad"]
  },
  "Clarinets": {
    canonicalCategory: "Clarinets",
    collectionHandle: "clarinets",
    aliases: ["clarinet", "clarinets", "bb clarinet", "bass clarinet"],
    productTypeHints: ["clarinet"],
    excludeAccessoryTerms: ["mouthpiece", "reed", "ligature", "case", "stand", "cleaning"]
  },
  "Flutes and Piccolos": {
    canonicalCategory: "Flutes and Piccolos",
    collectionHandle: "flutes-piccolos",
    aliases: ["flute", "flutes", "piccolo", "piccolos"],
    productTypeHints: ["flute", "piccolo"],
    excludeAccessoryTerms: ["case", "stand", "cleaning", "headjoint"]
  },

  // ---------- BRASS ----------
  "Trumpets": {
    canonicalCategory: "Trumpets",
    collectionHandle: "trumpets",
    aliases: ["trumpet", "trumpets", "bb trumpet", "c trumpet", "piccolo trumpet", "cornet", "flugelhorn"],
    productTypeHints: ["trumpet", "cornet", "flugelhorn"],
    excludeAccessoryTerms: ["mouthpiece", "case", "valve oil", "stand", "cleaning", "mute"]
  },
  "Trombones": {
    canonicalCategory: "Trombones",
    collectionHandle: "trombones",
    aliases: ["trombone", "trombones", "f attachment trombone", "trigger trombone", "valve trombone", "bass trombone"],
    productTypeHints: ["trombone"],
    excludeAccessoryTerms: ["case", "mouthpiece", "slide oil", "slide grease", "stand", "cleaning", "mute"]
  },
  "Euphoniums": {
    canonicalCategory: "Euphoniums",
    collectionHandle: "euphonium",
    // "baritone horn" only, NOT bare "baritone", so baritone sax is not captured here.
    aliases: ["euphonium", "euphoniums", "bombardino", "bombardinos", "baritone horn", "baritone euphonium"],
    productTypeHints: ["euphonium", "baritone horn"],
    excludeAccessoryTerms: ["case", "bag", "mouthpiece", "cleaning", "stand", "valve oil"]
  },
  "French Horns": {
    canonicalCategory: "French Horns",
    collectionHandle: "french-horns",
    aliases: ["french horn", "french horns", "horn in f"],
    productTypeHints: ["french horn"],
    excludeAccessoryTerms: ["case", "mouthpiece", "valve oil", "stand", "cleaning"]
  },
  "Tubas": {
    canonicalCategory: "Tubas",
    collectionHandle: "tubas",
    aliases: ["tuba", "tubas", "sousaphone"],
    productTypeHints: ["tuba", "sousaphone"],
    excludeAccessoryTerms: ["case", "mouthpiece", "valve oil", "stand", "cleaning"]
  },

  // ---------- FRETTED ----------
  "Guitars": {
    canonicalCategory: "Guitars",
    collectionHandle: "guitars",
    aliases: ["guitar", "guitars", "electric guitar", "acoustic guitar", "classical guitar", "acoustic electric guitar"],
    productTypeHints: ["guitar", "electric guitar", "acoustic guitar", "classical guitar"],
    excludeAccessoryTerms: ["cable", "strings", "case", "strap", "stand", "pick", "capo", "tuner", "adapter"]
  },
  "Bass Guitars": {
    canonicalCategory: "Bass Guitars",
    collectionHandle: "bass-guitars",
    aliases: ["bass guitar", "bass guitars", "electric bass", "acoustic bass", "5 string bass", "4 string bass"],
    productTypeHints: ["bass guitar", "electric bass"],
    excludeAccessoryTerms: ["cable", "strings", "case", "strap", "stand", "pick", "tuner", "adapter"]
  },

  // ---------- KEYS ----------
  "Keyboards and Pianos": {
    canonicalCategory: "Keyboards and Pianos",
    collectionHandle: "keyboards-pianos",
    aliases: ["keyboard", "keyboards", "piano", "digital piano", "stage piano", "workstation"],
    productTypeHints: ["keyboard", "digital piano", "stage piano", "workstation"],
    excludeAccessoryTerms: ["stand", "case", "pedal", "bench", "power supply", "adapter", "bag"]
  },
  "Synthesizers": {
    canonicalCategory: "Synthesizers",
    collectionHandle: "synthesizers",
    aliases: ["synth", "synthesizer", "synthesizers", "synth keyboard"],
    productTypeHints: ["synthesizer", "synth"],
    excludeAccessoryTerms: ["stand", "case", "power supply", "adapter", "bag"]
  },

  // ---------- PERCUSSION ----------
  "Drums": {
    canonicalCategory: "Drums",
    collectionHandle: "drums",
    aliases: ["drum", "drums", "drum kit", "drum set", "electronic drums", "snare drum"],
    productTypeHints: ["drum", "drum kit", "drum set"],
    excludeAccessoryTerms: ["stick", "sticks", "head", "heads", "stand", "throne", "case", "bag", "pedal", "key"]
  },
  "Percussion": {
    canonicalCategory: "Percussion",
    collectionHandle: "percussion",
    aliases: ["percussion", "cymbal", "cymbals", "congas", "bongos", "timbales", "marimba", "xylophone", "glockenspiel"],
    productTypeHints: ["percussion", "cymbal", "congas", "timbales", "marimba"],
    excludeAccessoryTerms: ["stand", "case", "bag", "mallet", "mallets"]
  },

  // ---------- STRINGS ----------
  "Orchestral Strings": {
    canonicalCategory: "Orchestral Strings",
    collectionHandle: "orchestral-strings",
    aliases: ["violin", "viola", "cello", "double bass", "upright bass", "orchestral strings"],
    productTypeHints: ["violin", "viola", "cello"],
    excludeAccessoryTerms: ["bow", "rosin", "case", "strings", "stand", "shoulder rest", "chin rest"]
  },

  // ---------- AUDIO ----------
  "Microphones": {
    canonicalCategory: "Microphones",
    collectionHandle: "microphones",
    aliases: ["microphone", "microphones", "mic", "mics", "condenser microphone", "dynamic microphone", "studio mic", "vocal mic", "wireless mic", "wireless microphone"],
    productTypeHints: ["microphone", "condenser microphone", "dynamic microphone", "wireless microphone"],
    excludeAccessoryTerms: ["stand", "cable", "clip", "shock mount", "pop filter", "case", "adapter", "windscreen"]
  },
  "Audio Interfaces": {
    canonicalCategory: "Audio Interfaces",
    collectionHandle: "audio-interfaces",
    aliases: ["audio interface", "audio interfaces", "recording interface", "sound interface", "sound card", "usb interface", "apollo", "volt"],
    productTypeHints: ["audio interface", "recording interface", "interface"],
    excludeAccessoryTerms: ["cable", "adapter", "case", "power supply"]
  },
  "Headphones": {
    canonicalCategory: "Headphones",
    collectionHandle: "headphones",
    aliases: ["headphone", "headphones", "studio headphones", "monitoring headphones", "closed back headphones", "in ear monitors", "iem", "earphones"],
    productTypeHints: ["headphone", "headphones", "in ear monitor"],
    excludeAccessoryTerms: ["cable", "case", "pads", "ear pads", "adapter"]
  },
  "Studio Monitors": {
    canonicalCategory: "Studio Monitors",
    collectionHandle: "studio-monitors",
    aliases: ["studio monitor", "studio monitors", "monitor speakers", "reference monitors", "powered monitors", "nearfield monitors"],
    productTypeHints: ["studio monitor", "monitor speaker"],
    excludeAccessoryTerms: ["stand", "cable", "isolation", "pad", "adapter"]
  },
  "Reverb and Effects": {
    canonicalCategory: "Reverb and Effects",
    collectionHandle: "reverb-effects",
    aliases: ["reverb", "effects processor", "hardware reverb", "bricasti", "outboard processor", "effects unit"],
    productTypeHints: ["reverb", "effects processor", "processor"],
    excludeAccessoryTerms: ["cable", "adapter", "rack", "power supply"]
  },
  "Mixers": {
    canonicalCategory: "Mixers",
    collectionHandle: "mixers",
    aliases: ["mixer", "mixers", "mixing console", "analog mixer", "digital mixer", "powered mixer"],
    productTypeHints: ["mixer", "mixing console"],
    excludeAccessoryTerms: ["cable", "case", "bag", "power supply", "adapter"]
  },
  "PA and Live Sound": {
    canonicalCategory: "PA and Live Sound",
    collectionHandle: "live-sound",
    aliases: ["pa speaker", "pa system", "powered speaker", "active speaker", "subwoofer", "stage monitor", "loudspeaker"],
    productTypeHints: ["pa speaker", "powered speaker", "loudspeaker", "subwoofer"],
    excludeAccessoryTerms: ["cable", "stand", "case", "bag", "cover", "adapter"]
  },

  // ---------- VIDEO ----------
  "PTZ Cameras": {
    canonicalCategory: "PTZ Cameras",
    collectionHandle: "ptz-cameras",
    aliases: ["ptz", "ptz camera", "ptz cameras", "church camera", "streaming camera", "broadcast camera"],
    productTypeHints: ["ptz camera", "camera"],
    excludeAccessoryTerms: ["cable", "mount", "controller", "power supply", "adapter", "bracket"]
  },
  "Video Switchers": {
    canonicalCategory: "Video Switchers",
    collectionHandle: "blackmagic-design",
    aliases: ["video switcher", "switcher", "atem", "broadcast switcher", "live production switcher", "production switcher"],
    productTypeHints: ["switcher", "live production switcher", "video switcher", "atem"],
    excludeAccessoryTerms: ["cable", "adapter", "case", "mount", "battery", "power supply"]
  },

  // ---------- ACCESSORY CATEGORIES (these ARE the product when requested) ----------
  "Cables": {
    canonicalCategory: "Cables",
    collectionHandle: "cables",
    isAccessoryCategory: true,
    aliases: ["cable", "cables", "xlr", "xlr cable", "trs cable", "instrument cable", "speaker cable", "usb cable", "hdmi cable", "sdi cable", "ethernet cable", "patch cable"],
    productTypeHints: ["cable", "adapter"],
    excludeAccessoryTerms: []
  },
  "Stands and Mounts": {
    canonicalCategory: "Stands and Mounts",
    collectionHandle: "stands-mounts",
    isAccessoryCategory: true,
    aliases: ["stand", "stands", "mic stand", "music stand", "speaker stand", "keyboard stand", "guitar stand", "mount", "mounts", "wall mount"],
    productTypeHints: ["stand", "mount"],
    excludeAccessoryTerms: []
  },
  "Cases and Bags": {
    canonicalCategory: "Cases and Bags",
    collectionHandle: "cases-bags",
    isAccessoryCategory: true,
    aliases: ["case", "cases", "gig bag", "gig bags", "hard case", "soft case", "bag", "flight case"],
    productTypeHints: ["case", "bag"],
    excludeAccessoryTerms: []
  }
};

// Find the best taxonomy category for a piece of text.
// Picks the LONGEST matching alias across every category, so specific phrases
// win over generic ones regardless of object order.
export function findTaxonomyCategory(input = "") {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return null;

  let best = null;
  let bestLength = 0;

  for (const [key, config] of Object.entries(TAXONOMY)) {
    const terms = [key, config.canonicalCategory, ...(config.aliases || [])];

    for (const term of terms) {
      const normalizedTerm = normalize(term);
      if (!normalizedTerm) continue;

      if (phraseInText(normalizedInput, normalizedTerm) && normalizedTerm.length > bestLength) {
        best = { key, ...config };
        bestLength = normalizedTerm.length;
      }
    }
  }

  return best;
}

export function buildTaxonomySearchQueries(intentData = {}) {
  const queries = [];
  const items = intentData.requestedItems || [];

  for (const item of items) {
    const rawText = [item.brand, item.product, item.category, item.searchQuery]
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
          [item.brand, item.product].filter(Boolean).join(" "),
          item.category,
          taxonomyMatch.canonicalCategory,
          ...(taxonomyMatch.aliases || []).slice(0, 4)
        ].filter(Boolean)
      });
    } else {
      // No taxonomy match is fine now. We still search with what we have.
      queries.push({
        requestedItem: item,
        taxonomyCategory: item.category || null,
        collectionHandle: null,
        searchQueries: [
          item.searchQuery,
          item.product,
          [item.brand, item.product].filter(Boolean).join(" "),
          [item.brand, item.product, item.category].filter(Boolean).join(" "),
          item.category
        ].filter(Boolean)
      });
    }
  }

  return queries;
}

export function normalizeText(value = "") {
  return normalize(value);
}

export { phraseInText };
