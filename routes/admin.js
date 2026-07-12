// admin.js — internal endpoints. Protected by ADMIN_TOKEN.

import express from "express";
import {
  syncCatalog,
  getLastSummary,
  getCatalogCount,
  getLastSync,
  getLastSource,
  checkAdminAuth
} from "../services/catalog.js";

const router = express.Router();

// SECURITY FIX: previously, a missing ADMIN_TOKEN left these routes wide open.
// Now, no token configured = access denied.
function authorized(req) {
  const required = process.env.ADMIN_TOKEN;
  if (!required) return false;
  return req.query.token === required || req.headers["x-admin-token"] === required;
}

// Check whether Admin API auth works, and how many products Shopify says exist.
// Run this FIRST after adding the client credentials.
router.get("/shopify-auth-status", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json(await checkAdminAuth());
});

router.get("/sync", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  try {
    res.json(await syncCatalog({ verbose: true }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Sync failed.", details: error.message });
  }
});

router.get("/catalog-summary", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json({
    count: getCatalogCount(),
    source: getLastSource(),
    lastSync: getLastSync(),
    summary: getLastSummary()
  });
});

router.get("/catalog-status", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json({
    count: getCatalogCount(),
    source: getLastSource(),
    lastSync: getLastSync()
  });
});

export default router;
