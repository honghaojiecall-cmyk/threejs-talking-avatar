import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, { timeout: 60000 });
const info = await page.evaluate(() => {
  const avatar = window.__MINT_AVATAR__;
  const THREE_scene = avatar.scene ?? null;
  return 'no scene ref';
});
console.log(info);
await browser.close();
