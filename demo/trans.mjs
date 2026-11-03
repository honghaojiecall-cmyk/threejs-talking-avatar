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
  // stash rest positions
  a.__restPos = new Map();
  for (const [k, d] of a.drivers) a.__restPos.set(k, d.bone.position.clone());
  window.__translateBone = (key, wx, wy, wz) => {
    const d = a.drivers.get(key);
    const rp = a.__restPos.get(key);
    d.bone.position.set(rp.x, rp.y, rp.z);
    // convert world offset into parent local space
    const parent = d.bone.parent;
    parent.updateWorldMatrix(true, false);
    const pq = new d.rest.constructor();
    parent.getWorldQuaternion(pq);
    const inv = pq.clone().invert();
    const v = new d.bone.position.constructor(wx, wy, wz).applyQuaternion(inv);
    // account for parent world scale
    const ps = new d.bone.position.constructor();
    parent.getWorldScale(ps);
    v.x /= ps.x; v.y /= ps.y; v.z /= ps.z;
    d.bone.position.add(v);
  };
});
await page.evaluate(() => {
  window.__translateBone('lowerLipM', 0, -0.008, 0.002);
  window.__translateBone('lowerLipL1', 0, -0.006, 0.001);
  window.__translateBone('lowerLipR1', 0, -0.006, 0.001);
  window.__translateBone('upperLipM', 0, 0.003, 0.001);
});
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/trans-open.png' });
await browser.close();
console.log('done');
