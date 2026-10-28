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
  a.__restPos = new Map();
  for (const [k, d] of a.drivers) a.__restPos.set(k, d.bone.position.clone());
  window.__translateBone = (key, wx, wy, wz) => {
    const d = a.drivers.get(key);
    const rp = a.__restPos.get(key);
    d.bone.position.set(rp.x, rp.y, rp.z);
    const parent = d.bone.parent;
    parent.updateWorldMatrix(true, false);
    const pq = new d.rest.constructor();
    parent.getWorldQuaternion(pq);
    const inv = pq.clone().invert();
    const v = new d.bone.position.constructor(wx, wy, wz).applyQuaternion(inv);
    const ps = new d.bone.position.constructor();
    parent.getWorldScale(ps);
    v.x /= ps.x; v.y /= ps.y; v.z /= ps.z;
    d.bone.position.add(v);
  };
  window.__resetBones = () => {
    for (const [k, d] of a.drivers) {
      d.bone.quaternion.copy(d.rest);
      const rp = a.__restPos.get(k);
      d.bone.position.set(rp.x, rp.y, rp.z);
    }
  };
});
const shots = {
  blink: "['eyelidUpL','eyelidUpR'].forEach(k=>__translateBone(k,0,-0.006,0.001));['eyelidLoL','eyelidLoR'].forEach(k=>__translateBone(k,0,0.002,0))",
  browup: "['browInnerL','browMidL','browOuterL','browInnerR','browMidR','browOuterR'].forEach(k=>__translateBone(k,0,0.004,0))",
  browfurrow: "['browInnerL','browInnerR'].forEach(k=>__translateBone(k,0,-0.003,0.001))",
  smile: "['cornerL'].forEach(k=>__translateBone(k,-0.005,0.004,0));['cornerR'].forEach(k=>__translateBone(k,0.005,0.004,0));['mouthCornerL'].forEach(k=>__translateBone(k,-0.004,0.003,0));['mouthCornerR'].forEach(k=>__translateBone(k,0.004,0.003,0))",
  gazey: "__translateBone('eyeballL',0.004,0,0);__translateBone('eyeballR',0.004,0,0)",
};
for (const [name, code] of Object.entries(shots)) {
  await page.evaluate((c) => { window.__resetBones(); eval(c); }, code);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `/tmp/face-${name}.png` });
}
await browser.close();
console.log('done');
