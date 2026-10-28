import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, { timeout: 60000 });
await page.evaluate(() => {
  window.__GNM_AVATAR_TEST_HOOKS__?.hideDebugUi(true);
  window.__GNM_AVATAR_TEST_HOOKS__?.setPausedForScreenshot(true);
  const a = window.__MINT_AVATAR__;
  a.controls.minDistance = 0.01; a.controls.maxDistance = 10;
});
// far front
await page.evaluate(() => { const a = window.__MINT_AVATAR__; a.camera.position.set(0, 1.0, 2.5); a.controls.target.set(0, 0.9, 0); a.camera.lookAt(0, 0.9, 0); });
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/mint-far-front.png' });
// far back
await page.evaluate(() => { const a = window.__MINT_AVATAR__; a.camera.position.set(0, 1.0, -2.5); a.controls.target.set(0, 0.9, 0); a.camera.lookAt(0, 0.9, 0); });
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/mint-far-back.png' });
await browser.close();
console.log('done');
