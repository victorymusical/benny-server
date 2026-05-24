import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRoutes from "./routes/chat.js";
import path from "path";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/chat", chatRoutes);
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Benny Server",
    message: "Benny backend is running."
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Benny server running on port ${port}`);
});
