import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, { timeout: 60000 });
await page.evaluate(() => {
  window.__GNM_AVATAR_TEST_HOOKS__?.hideDebugUi(true);
  window.__GNM_AVATAR_TEST_HOOKS__?.setPausedForScreenshot(true);
  document.querySelector('#speech-studio')?.style.setProperty('display', 'none');
});
const poses = JSON.parse(process.argv[2]);
for (const [name, pose] of Object.entries(poses)) {
  await page.evaluate((p) => window.__MINT_AVATAR__.debugPoseChannels(p), pose);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `/tmp/pose-${name}.png` });
}
await browser.close();
console.log('done');
