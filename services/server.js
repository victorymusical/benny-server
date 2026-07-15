import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRoutes from "./routes/chat.js";
import debugRoutes from "./routes/debug.js";
import adminRoutes from "./routes/admin.js";
import { logModelConfig } from "./services/models.js";
import {
  loadCatalogFromDisk,
  syncCatalog,
  getCatalogCount,
  getActiveCount
} from "./services/catalog.js";

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
    catalogProducts: getCatalogCount(),
    sellable: getActiveCount()
  });
});

const port = process.env.PORT || 3000;

// Railway sends SIGTERM when a newer queued deployment replaces this
// container. Without a handler, Node exits non-zero and Railway cosmetically
// labels the superseded deploy "Crashed". Exit cleanly instead.
const shutdown = signal => {
  console.log(`${signal} received — shutting down cleanly.`);
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

app.listen(port, async () => {
  console.log(`Benny server running on port ${port}`);
  logModelConfig();

  // ------------------------------------------------------------------
  // CRITICAL: Benny must NEVER serve customers with an empty catalog.
  //
  // Railway's filesystem is EPHEMERAL — it is wiped on every deploy. That
  // erased Benny's saved catalog, leaving him blind until someone manually
  // ran a sync. He then told customers we don't carry products we've had in
  // stock for a month (the BARI reed incident).
  //
  // Now: on boot, load from disk. If that comes up empty (i.e. Railway just
  // wiped it), sync immediately and automatically. A deploy can no longer
  // blind him.
  // ------------------------------------------------------------------
  const loaded = loadCatalogFromDisk();

  if (!loaded || getCatalogCount() === 0) {
    console.log("Catalog is EMPTY on boot (Railway wipes the filesystem on deploy).");
    console.log("Auto-syncing now so Benny is never blind to the catalog...");
    try {
      const result = await syncCatalog({ verbose: true });
      console.log(`Auto-sync complete: ${result.count} products (${result.active} sellable).`);
    } catch (err) {
      console.error("AUTO-SYNC FAILED — Benny has no catalog:", err.message);
      // Retry once shortly after; a transient Shopify hiccup shouldn't leave
      // him blind for hours until the next scheduled refresh.
      setTimeout(() => {
        console.log("Retrying catalog sync...");
        syncCatalog({ verbose: false }).catch(e =>
          console.error("Retry also failed:", e.message)
        );
      }, 60_000);
    }
  } else {
    console.log(`Catalog loaded from disk: ${getCatalogCount()} products.`);
  }

  // Scheduled refresh so new products appear without a deploy.
  const hours = Number(process.env.CATALOG_SYNC_HOURS || 6);
  if (hours > 0) {
    setInterval(() => {
      console.log("Scheduled catalog refresh...");
      syncCatalog({ verbose: false }).catch(err =>
        console.error("Scheduled sync failed:", err.message)
      );
    }, hours * 60 * 60 * 1000);
  }
});
