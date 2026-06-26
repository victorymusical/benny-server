import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRoutes from "./routes/chat.js";
import debugRoutes from "./routes/debug.js";
import adminRoutes from "./routes/admin.js";
import { loadCatalogFromDisk, syncCatalog, getCatalogCount } from "./services/catalog.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/chat", chatRoutes);
app.use(express.static("public"));
app.use("/api/debug", debugRoutes);
app.use("/api/admin", adminRoutes);

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Benny Server",
    message: "Benny backend is running.",
    catalogProducts: getCatalogCount()
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Benny server running on port ${port}`);

  // Load the saved catalog immediately so Benny has it on boot.
  const loaded = loadCatalogFromDisk();

  // If nothing was saved yet, do an initial sync in the background.
  if (!loaded) {
    console.log("No saved catalog found. Running initial sync in the background...");
    syncCatalog({ verbose: true }).catch(err =>
      console.error("Initial catalog sync failed:", err.message)
    );
  }

  // Refresh on a schedule. Default every 6 hours; override with CATALOG_SYNC_HOURS.
  const hours = Number(process.env.CATALOG_SYNC_HOURS || 6);
  if (hours > 0) {
    setInterval(() => {
      console.log("Scheduled catalog refresh starting...");
      syncCatalog({ verbose: false }).catch(err =>
        console.error("Scheduled catalog sync failed:", err.message)
      );
    }, hours * 60 * 60 * 1000);
  }
});
