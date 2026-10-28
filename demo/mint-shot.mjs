import { chromium } from 'playwright';
const pose = process.argv[2] || null;
const out = process.argv[3] || '/tmp/mint.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR:', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('PAGE_ERR:', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, { timeout: 60000 }).catch(() => console.log('LOAD TIMEOUT'));
await page.evaluate(() => {
  window.__GNM_AVATAR_TEST_HOOKS__?.hideDebugUi(true);
  window.__GNM_AVATAR_TEST_HOOKS__?.setPausedForScreenshot(true);
});
if (pose) await page.evaluate((p) => window.__GNM_AVATAR_TEST_HOOKS__?.setState(p), pose);
await page.waitForTimeout(800);
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
