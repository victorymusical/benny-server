export function normalizeCategoryFromMessages(messages = []) {
  const text = messages
    .filter(m => m.role === "user")
    .map(m => String(m.content || "").toLowerCase())
    .join(" ");

  const categories = [
    {
      category: "Audio Interfaces",
      searchTerms: ["audio interface", "recording interface", "sound interface", "sound card", "usb interface", "mic interface", "guitar interface", "podcast interface"]
    },
    {
      category: "Microphones",
      searchTerms: ["microphone", "mic", "vocal mic", "podcast mic", "condenser", "dynamic mic", "instrument mic"]
    },
    {
      category: "Headphones",
      searchTerms: ["headphones", "studio headphones", "monitoring headphones", "closed back", "closed-back"]
    },
    {
      category: "Saxophones",
      searchTerms: ["saxophone", "sax", "alto sax", "tenor sax", "soprano sax", "baritone sax"]
    },
    {
      category: "Trumpets",
      searchTerms: ["trumpet"]
    },
    {
      category: "Trombones",
      searchTerms: ["trombone"]
    },
    {
      category: "Clarinets",
      searchTerms: ["clarinet"]
    },
    {
      category: "Flutes",
      searchTerms: ["flute", "piccolo"]
    },
    {
      category: "Guitars",
      searchTerms: ["guitar", "electric guitar", "acoustic guitar", "classical guitar", "bass guitar"]
    },
    {
      category: "PTZ Cameras",
      searchTerms: ["ptz", "ptz camera", "church camera", "streaming camera"]
    }
  ];

  for (const item of categories) {
    if (item.searchTerms.some(term => text.includes(term))) {
      return item.category;
    }
  }

  return null;
}
