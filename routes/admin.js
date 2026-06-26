// admin.js
// Internal endpoints to run the catalog sync and read the summary.
// Protect by setting ADMIN_TOKEN in Railway, then call with ?token=YOURTOKEN.

import express from "express";
import {
  syncCatalog,
  getLastSummary,
  getCatalogCount,
  getLastSync
} from "../services/catalog.js";

const router = express.Router();

function authorized(req) {
  const required = process.env.ADMIN_TOKEN;
  if (!required) return true; // no token set yet: allow, but you should set one
  return req.query.token === required || req.headers["x-admin-token"] === required;
}

// Trigger a full catalog sync and return the one-page summary.
router.get("/sync", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  try {
    const result = await syncCatalog({ verbose: true });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Sync failed.", details: error.message });
  }
});

// Read the last summary without re-syncing.
router.get("/catalog-summary", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json({
    count: getCatalogCount(),
    lastSync: getLastSync(),
    summary: getLastSummary()
  });
});

// Quick health/status.
router.get("/catalog-status", (req, res) => {
  res.json({ count: getCatalogCount(), lastSync: getLastSync() });
});

export default router;
