import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

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
