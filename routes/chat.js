import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";

const router = express.Router();

function loadKnowledgeFile(filename) {
  const filePath = path.join(process.cwd(), "knowledge", filename);

  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.warn(`Knowledge file missing: ${filename}`);
    return "";
  }
}

router.post("/", async (req, res) => {
  try {
    const { messages } = req.body;

    const salesKnowledge = loadKnowledgeFile("sales-methodology.md");
    const conversationalRules = loadKnowledgeFile("conversational-rules.md");
    const categoryGovernance = loadKnowledgeFile("category-governance.md");

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
You are Benny, a consultative AI advisor for Victory Musical Instruments.

Follow this internal knowledge carefully.

SALES METHODOLOGY:
${salesKnowledge}

CONVERSATIONAL RULES:
${conversationalRules}

CATEGORY GOVERNANCE:
${categoryGovernance}

Core behavior:
- Keep responses concise and helpful
- Avoid filler conversation
- Act like a professional consultant, not a pushy salesperson
- Remember prior customer answers in the conversation
- Ask only one useful question at a time
- Never recommend products or brands outside VictoryMusical.com
`
        },
        ...messages
      ]
    });

    res.json({
      reply: response.choices[0].message.content
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Benny encountered an error."
    });
  }
});

export default router;
