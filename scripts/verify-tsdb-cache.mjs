// Usage: node scripts/verify-tsdb-cache.mjs
// Exercises the cold/warm/not-found paths and times them.
const BASE = process.env.BASE_URL || "http://localhost:3000";

async function hit(name, team) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/tsdb-player?name=${encodeURIComponent(name)}&team=${encodeURIComponent(team)}`);
  const body = await res.json();
  return { ms: Date.now() - t0, body };
}

async function main() {
  console.log("🔍 COLD:   Kylian Mbappé / Real Madrid");
  const cold = await hit("Kylian Mbappé", "Real Madrid");
  console.log(`  ${cold.ms} ms  ${cold.body ? "HIT" : "MISS"}`);

  console.log("\n🔥 WARM (same request):");
  const warm = await hit("Kylian Mbappé", "Real Madrid");
  console.log(`  ${warm.ms} ms  ${warm.body ? "HIT" : "MISS"}`);

  if (warm.ms > cold.ms) {
    console.warn("\n⚠️  warm read is slower than cold — check if DB cache is being used");
  }

  console.log("\n🚫 NOT FOUND:");
  const miss = await hit("Zzzz Doesnotexist", "Nowhere FC");
  console.log(`  ${miss.ms} ms  ${miss.body === null ? "NULL (expected)" : JSON.stringify(miss.body)}`);

  console.log("\n✅ verify-tsdb-cache done");
}

main().catch(e => { console.error(e); process.exit(1); });
