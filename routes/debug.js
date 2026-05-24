import express from "express";
import { searchShopifyProducts } from "../services/shopify.js";
import { getVendorsForCategory } from "../services/vendors.js";

const router = express.Router();

router.get("/products", async (req, res) => {
  try {
    const query = req.query.q || "audio interface";
    const products = await searchShopifyProducts(query, 50);

    res.json({
      query,
      count: products.length,
      vendors: [...new Set(products.map(p => p.vendor).filter(Boolean))],
      products
    });
  } catch (error) {
    res.status(500).json({
      error: "Debug product search failed.",
      details: error.message
    });
  }
});

router.get("/vendors", async (req, res) => {
  try {
    const category = req.query.category || "Audio Interfaces";
    const vendors = await getVendorsForCategory(category);

    res.json({
      category,
      vendors
    });
  } catch (error) {
    res.status(500).json({
      error: "Debug vendor search failed.",
      details: error.message
    });
  }
});

export default router;
