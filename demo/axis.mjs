import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, { timeout: 60000 });
await page.evaluate(() => {
  window.__GNM_AVATAR_TEST_HOOKS__?.hideDebugUi(true);
  window.__GNM_AVATAR_TEST_HOOKS__?.setPausedForScreenshot(true);
  document.querySelector('#speech-studio')?.style.setProperty('display', 'none');
  const a = window.__MINT_AVATAR__;
  a.applyPose = () => {};
  a.updateHeadRotation = () => {};
});
const bone = process.argv[2], angle = parseFloat(process.argv[3]);
for (const axis of ['x','y','z','nx','ny','nz']) {
  await page.evaluate(([b, ax, ang]) => {
    const a = window.__MINT_AVATAR__;
    const d = a.drivers.get(b);
    d.bone.quaternion.copy(d.rest);
    const sign = ax.startsWith('n') ? -1 : 1;
    const key = ax.replace('n','');
    const vec = { x: [1,0,0], y: [0,1,0], z: [0,0,1] }[key];
    const half = sign * ang / 2, s = Math.sin(half), c = Math.cos(half);
    const rot = new d.rest.constructor(vec[0] * s, vec[1] * s, vec[2] * s, c);
    d.bone.quaternion.copy(d.rest).multiply(rot);
  }, [bone, axis, angle]);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `/tmp/axis-${bone}-${axis}.png` });
}
await browser.close();
console.log('done');
