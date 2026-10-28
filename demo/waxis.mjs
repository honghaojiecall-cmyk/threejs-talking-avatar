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
  window.__rotateWorld = (boneKey, wx, wy, wz, ang) => {
    const d = a.drivers.get(boneKey);
    const parent = d.bone.parent;
    parent.updateWorldMatrix(true, false);
    const pq = new d.rest.constructor();
    parent.getWorldQuaternion(pq);
    const half = ang / 2, s = Math.sin(half), c = Math.cos(half);
    const qw = new d.rest.constructor(wx * s, wy * s, wz * s, c);
    const inv = pq.clone().invert();
    const local = inv.clone().multiply(qw).multiply(pq);
    d.bone.quaternion.copy(local).multiply(d.rest);
  };
});
const bone = process.argv[2], angle = parseFloat(process.argv[3]);
for (const spec of [['x+',1,0,0],['x-',-1,0,0],['y+',0,1,0],['y-',0,-1,0],['z+',0,0,1],['z-',0,0,-1]]) {
  await page.evaluate(([b, v, ang]) => {
    const a = window.__MINT_AVATAR__;
    const d = a.drivers.get(b);
    d.bone.quaternion.copy(d.rest);
    window.__rotateWorld(b, v[0], v[1], v[2], ang);
  }, [bone, spec.slice(1), angle]);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `/tmp/waxis-${bone}-${spec[0]}.png` });
}
await browser.close();
console.log('done');
