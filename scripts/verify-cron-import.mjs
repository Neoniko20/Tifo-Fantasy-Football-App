#!/usr/bin/env node
/**
 * Manual verification of /api/cron/import-gw-stats.
 * Reads CRON_SECRET from .env.local and hits the local dev server.
 *
 * Usage: node scripts/verify-cron-import.mjs
 *
 * Pre-requisites:
 *   - npm run dev is running on localhost:3000
 *   - .env.local has CRON_SECRET set
 */

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(line => line.includes("=") && !line.startsWith("#"))
    .map(line => {
      const [k, ...v] = line.split("=");
      return [k.trim(), v.join("=").trim()];
    }),
);

const SECRET = env.CRON_SECRET;
if (!SECRET) {
  console.error("❌ CRON_SECRET not in .env.local");
  process.exit(1);
}

console.log("🔐 Calling /api/cron/import-gw-stats with bearer token...");

const res = await fetch("http://localhost:3000/api/cron/import-gw-stats", {
  headers: { authorization: `Bearer ${SECRET}` },
});

if (!res.ok) {
  console.error(`❌ HTTP ${res.status}:`, await res.text());
  process.exit(1);
}

const json = await res.json();
console.log("✅ Response:", JSON.stringify(json, null, 2));
console.log(`📊 Pending: ${json.pending}, Results: ${json.results.length}`);

const failures = json.results.filter(r => !r.ok);
if (failures.length > 0) {
  console.warn(`⚠ ${failures.length} import(s) failed:`);
  for (const f of failures) {
    console.warn(`  - league ${f.leagueId} GW${f.gameweek}: ${f.message}`);
  }
}
