import fs from "fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync("itic-detail.html", "utf-8");
const dom = new JSDOM(html);
const document = dom.window.document;

const table = document.querySelector("#DistrictNotificationTable");
if (!table) {
  console.log("No table found!");
  process.exit(1);
}

const rows = table.querySelectorAll("tbody tr");
console.log(`Found ${rows.length} rows`);

rows.forEach((row, i) => {
  const cells = [...row.querySelectorAll("td")].map(td => td.textContent.trim());
  console.log(`Row ${i}:`, cells);
});
