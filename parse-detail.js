import fs from "fs";

const html = fs.readFileSync("itic-detail.html", "utf-8");

// Search for companyName and print occurrences that are not commented out, or see if it's in a JS variable
const lines = html.split("\n");
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes("companyName")) {
    console.log(`Line ${i + 1}:`);
    console.log(line.substring(0, 300));
  }
}
