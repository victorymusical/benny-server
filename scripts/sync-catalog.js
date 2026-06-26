// Standalone catalog sync. Run manually with:  node scripts/sync-catalog.js
// Or point a Railway scheduled job at this file to refresh on a schedule.

import dotenv from "dotenv";
import { syncCatalog, summarizeCatalog } from "../services/catalog.js";

dotenv.config();

(async () => {
  try {
    const result = await syncCatalog({ verbose: true });
    console.log("\n================ CATALOG SUMMARY ================");
    console.log(JSON.stringify(result.summary, null, 2));
    console.log("================================================");
    console.log(`Total products: ${result.count}`);
    process.exit(0);
  } catch (err) {
    console.error("Sync failed:", err.message);
    process.exit(1);
  }
})();
