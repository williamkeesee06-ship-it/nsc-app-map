import fs from "fs";
import path from "path";

const filePath = "C:/Users/willi/.gemini/antigravity/brain/6efde22c-8614-4ca3-baea-16f3b95bcef7/.system_generated/steps/2458/content.md";
const content = fs.readFileSync(filePath, "utf-8");

console.log("File length:", content.length);

// Let's find common My Maps JS variables
const patterns = [
  "bootstrapData",
  "_pageData",
  "_AMP_DEVICE_SETTINGS",
  "viewer?mid=",
  "kml",
  "kmz",
  "FeatureCollection"
];

for (const pattern of patterns) {
  const index = content.indexOf(pattern);
  if (index !== -1) {
    console.log(`Found pattern "${pattern}" at index ${index}. Context:`);
    console.log(content.substring(index - 100, index + 300));
    console.log("-----------------------------------------");
  } else {
    console.log(`Pattern "${pattern}" not found`);
  }
}
