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
const poses = {
  idle: {},
  openvowel: { jaw: 0.75, stretch: 0.1 },
  bilabial: { bilabial: 1 },
  rounded: { jaw: 0.35, round: 0.85 },
  blink: { blink: 1 },
  smile: { smile: 1, cornersUp: 0.8 },
  browfurrow: { browFurrow: 1 },
  gaze: { gazeX: 0.8, gazeY: 0.4, browLift: 0.6 },
};
for (const [name, pose] of Object.entries(poses)) {
  await page.evaluate((p) => {
    window.__MINT_AVATAR__.debugPoseChannels(p);
  }, pose);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `/tmp/pose-${name}.png` });
}
await browser.close();
console.log('done');
