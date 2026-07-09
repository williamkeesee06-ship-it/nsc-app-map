import { chromium } from "playwright";
import dotenv from "dotenv";
import { checkUtilityResponses, login } from "./functions/lib/itic.js";

dotenv.config({ path: ".env.local" });

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  console.log("Logging into ITIC...");
  await login(page, {
    username: process.env.ITIC_USERNAME || 'wkeesee@northskycomm.com',
    password: process.env.ITIC_PASSWORD || 'Blazers#06'
  });
  
  const ticket = '26305763';
  console.log(`Running checkUtilityResponses for ticket ${ticket}...`);
  const results = await checkUtilityResponses(page, ticket);
  
  console.log("Scraped results:", JSON.stringify(results, null, 2));
  
  await browser.close();
}

run().catch(console.error);
