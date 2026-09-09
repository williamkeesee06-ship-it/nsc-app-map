import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const geojson = {
  type: "FeatureCollection",
  name: "H2043_Lake_Stevens_Platform",
  crs: { type: "name", properties: { name: "EPSG:4326" } },
  metadata: {
    projectId: "H2043",
    workOrder: "6007556",
    city: "Snohomish, WA",
    hub: { lat: 47.9000, lng: -122.0500 }, // Approximate center
    stats: {
      services: 155,
      terminals: 36,
      cables: 100,
    }
  },
  features: [
    {
      type: "Feature",
      id: "hub-H2043",
      geometry: { type: "Point", coordinates: [-122.0500, 47.9000] },
      properties: {
        type: "hub",
        layer: "hub",
        terminalId: "H2043",
        hubId: "H2043",
        label: "FDH H2043 — 432-port vault",
        address: "15718 Dubuque Rd, Snohomish WA",
        status: "spliced",
      }
    },
    // Mainline feeder
    {
      type: "Feature",
      id: "feeder-mainline",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.0500, 47.9000],
          [-122.0510, 47.9010],
          [-122.0520, 47.9020],
          [-122.0530, 47.9015],
          [-122.0550, 47.9030],
        ]
      },
      properties: {
        type: "feeder",
        layer: "feeder",
        cableId: "MAINLINE-H2043",
        fiberCount: 288,
        label: "Mainline Feeder",
        status: "fiber_placed",
        lengthM: 1500
      }
    },
    // Terminal 1
    {
      type: "Feature",
      id: "terminal-t1",
      geometry: { type: "Point", coordinates: [-122.0550, 47.9030] },
      properties: {
        type: "terminal",
        layer: "terminal",
        terminalId: "T1",
        label: "T1 (2421.201) 164th Dr SE",
        status: "designed",
      }
    },
    // Distribution 1
    {
      type: "Feature",
      id: "dist-t1",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.0550, 47.9030],
          [-122.0560, 47.9035],
          [-122.0570, 47.9040],
        ]
      },
      properties: {
        type: "distribution",
        layer: "distribution",
        cableId: "DIST-T1",
        fiberCount: 48,
        label: "T1 Distribution",
        status: "designed",
        lengthM: 300
      }
    },
    // A live drop
    {
      type: "Feature",
      id: "drop-1",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.0550, 47.9030],
          [-122.0545, 47.9035],
        ]
      },
      properties: {
        type: "drop",
        layer: "drop",
        cableId: "DROP-4433",
        label: "Drop to 4433 164th Dr SE",
        status: "live",
        lengthM: 50
      }
    }
  ]
};

const outPath = path.join(__dirname, "../apps/web/public/experiments/lake-stevens/h2043/platform.geojson");
fs.writeFileSync(outPath, JSON.stringify(geojson, null, 2));
console.log("Wrote " + outPath);
