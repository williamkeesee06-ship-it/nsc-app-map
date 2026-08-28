import { chromium } from 'playwright';

(async () => {
  console.log("Starting health check...");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  
  // We don't have a dev server running. Let's try the live Vercel deployment first.
  const url = 'https://nsc-app-map.vercel.app';
  console.log(`Navigating to ${url}...`);
  
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    console.log("Page loaded.");
    
    // Check if there are any Google Maps errors
    const mapsErrors = errors.filter(e => e.includes('Google Maps') || e.includes('googleapis'));
    if (mapsErrors.length > 0) {
      console.error("FAILED: Google Maps API Errors detected:", mapsErrors);
    } else {
      console.log("PASSED: No Google Maps API errors.");
    }
    
    // Output all errors for inspection
    if (errors.length > 0) {
      console.log("Console errors observed:", errors);
    } else {
      console.log("PASSED: No console errors.");
    }
    
    console.log("Health check complete.");
  } catch (err) {
    console.error("Failed to load page:", err);
  } finally {
    await browser.close();
  }
})();
