// One-time geocode for Lumen WA Central Offices.
// Reads ../../central_offices_raw.csv -> writes apps/web/src/data/centralOffices.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSV = path.resolve("/home/user/workspace/central_offices_raw.csv");
const OUT = path.join(ROOT, "apps/web/src/data/centralOffices.json");

// Load .env.local manually
const envFile = path.join(ROOT, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"\n]+)"?$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const KEY = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
if (!KEY) {
  console.error("No API key found");
  process.exit(1);
}

function parseCsv(txt) {
  const lines = txt.trim().split("\n");
  const headers = lines.shift().split(",").map((h) => h.trim());
  return lines.map((line) => {
    // simple CSV split, fields don't contain commas in this dataset
    const cells = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

async function geocode(addr) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addr)}&key=${KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== "OK") {
    console.warn(`  ! ${addr} → ${json.status} ${json.error_message ?? ""}`);
    return null;
  }
  const loc = json.results[0]?.geometry?.location;
  if (!loc) return null;
  return { lat: loc.lat, lng: loc.lng, formatted: json.results[0].formatted_address };
}

const rows = parseCsv(fs.readFileSync(CSV, "utf8"));
console.log(`Geocoding ${rows.length} central offices...`);

const out = [];
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const addr = `${r.address}, ${r.city}, ${r.state} ${r.zip}`;
  process.stdout.write(`[${i + 1}/${rows.length}] ${r.name} ... `);
  const g = await geocode(addr);
  if (g) {
    out.push({ name: r.name, address: addr, lat: g.lat, lng: g.lng });
    console.log("ok");
  } else {
    console.log("FAILED");
  }
  // rate limit: 50 qps is fine, but be polite
  await new Promise((r) => setTimeout(r, 40));
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\nWrote ${out.length}/${rows.length} → ${OUT}`);
