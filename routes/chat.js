import express from "express";
import client from "../services/openai.js";
import fs from "fs";
import path from "path";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
  const { messages } = req.body;

    const knowledgePath = path.join(
      process.cwd(),
      "knowledge",
      "sales-methodology.md"
    );

    const salesKnowledge = fs.readFileSync(knowledgePath, "utf8");

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
messages: [
  {
    role: "system",
    content: `
You are Benny, a consultative AI advisor for Victory Musical Instruments.

Follow these principles:
${salesKnowledge}

Keep responses concise and helpful.
Avoid filler conversation.
Act like a professional consultant, not a pushy salesperson.
Remember prior customer answers in the conversation.
Ask only one useful question at a time.
`
        },
        {
          content: messages
        }
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
