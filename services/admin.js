// admin.js — internal endpoints. Protected by ADMIN_TOKEN.

import express from "express";
import {
  syncCatalog,
  getLastSummary,
  getCatalogCount,
  getActiveCount,
  getDraftCount,
  getLastSync,
  getLastSource,
  checkAdminAuth,
  getAllProducts
} from "../services/catalog.js";
import { searchCatalog, findByVendor, slim } from "../services/catalogSearch.js";
import { MODELS } from "../services/models.js";

const router = express.Router();

function authorized(req) {
  const required = process.env.ADMIN_TOKEN;
  if (!required) return false;
  return req.query.token === required || req.headers["x-admin-token"] === required;
}

// Which model powers each stage. Set via Railway env vars:
// BENNY_MAIN_MODEL, BENNY_ASSESS_MODEL, BENNY_VALIDATOR_MODEL,
// BENNY_FAST_MODEL, BENNY_EMBEDDING_MODEL.
router.get("/model-config", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json({
    assessment: MODELS.assess,
    main_advisor: MODELS.main,
    validator: MODELS.validator,
    fast_reserved: MODELS.fast,
    embeddings_reserved: MODELS.embedding
  });
});

router.get("/shopify-auth-status", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json(await checkAdminAuth());
});

router.get("/sync", async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  try {
    res.json(await syncCatalog({ verbose: true }));
  } catch (error) {
    res.status(500).json({ error: "Sync failed.", details: error.message });
  }
});

router.get("/catalog-summary", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json({
    count: getCatalogCount(),
    active: getActiveCount(),
    draft: getDraftCount(),
    source: getLastSource(),
    lastSync: getLastSync(),
    summary: getLastSummary()
  });
});

router.get("/catalog-status", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  res.json({
    count: getCatalogCount(),
    active: getActiveCount(),
    draft: getDraftCount(),
    source: getLastSource(),
    lastSync: getLastSync()
  });
});

// DIAGNOSTIC: run the exact search Benny runs. Shows what he actually sees.
//   /api/admin/catalog-search?token=X&q=saxophone+reed
router.get("/catalog-search", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  const q = String(req.query.q || "");
  const includeDrafts = req.query.drafts === "true";
  const results = searchCatalog(q, { limit: 15, includeDrafts }).map(slim);
  res.json({
    query: q,
    includeDrafts,
    found: results.length,
    products: results.map(p => ({
      handle: p.handle,
      title: p.title,
      vendor: p.vendor,
      productType: p.productType,
      status: p.status,
      sellable: p.sellable,
      price: p.price,
      hasImage: !!p.image,
      hasCart: !!p.addToCartUrl
    }))
  });
});

// DIAGNOSTIC: inspect a vendor's raw records exactly as stored.
//   /api/admin/vendor?token=X&name=BARI
router.get("/vendor", (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized." });
  const name = String(req.query.name || "");
  const all = getAllProducts();
  const matches = all.filter(p =>
    (p.vendor || "").toLowerCase().includes(name.toLowerCase())
  );
  res.json({
    vendor: name,
    total: matches.length,
    active: matches.filter(p => p.sellable).length,
    draft: matches.filter(p => !p.sellable).length,
    sample: matches.slice(0, 10).map(p => ({
      handle: p.handle,
      title: p.title,
      productType: p.productType,
      status: p.status,
      sellable: p.sellable,
      price: p.price,
      hasImage: !!p.image,
      hasCart: !!p.addToCartUrl,
      collections: p.collections
    }))
  });
});

export default router;
