import { chromium } from "playwright";
import fs from "fs";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  await page.goto("https://wa.itic.occinc.com");
  await page.fill('input[placeholder="Username"]', 'wkeesee@northskycomm.com');
  await page.fill('input[placeholder="Password"]', 'Blazers#06');
  await page.click('button:has-text("Log in")');
  await page.waitForLoadState("networkidle");
  console.log("Logged in:", page.url());

  // Use JS to fill and search - bypasses visibility issues
  await page.evaluate(() => {
    document.getElementById('ETMTicketNumber').value = '26305763';
    generalTicketSearch();
  });
  
  // Wait for AJAX results
  await page.waitForTimeout(5000);
  await page.waitForLoadState("networkidle");
  
  // Find and click the ticket link
  const link = page.locator('a[id^="ticketlink-"]').first();
  const href = await link.getAttribute('href');
  console.log("Ticket link href:", href);
  
  // Navigate to detail page
  await link.click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  console.log("Detail URL:", page.url());
  
  await page.screenshot({ path: 'itic-detail.png', fullPage: true });
  fs.writeFileSync("itic-detail.html", await page.content());
  console.log("Done - saved itic-detail.png and itic-detail.html");
  
  await browser.close();
}

run().catch(e => { console.error(e.message); process.exit(1); });
