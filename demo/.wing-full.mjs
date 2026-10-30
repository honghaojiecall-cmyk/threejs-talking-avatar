import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5188/demo/index.html');
await page.waitForFunction(() => window.__IP_AVATAR__);
await page.waitForTimeout(1500);
const res = await page.evaluate(() => {
  // reconstruct original: the LEFT half mesh currently has the left-component geometry
  // but with per-triangle duplicated verts. Instead load the GLB fresh.
  return new Promise((resolve) => {
    // access THREE via the scene's constructor chain is messy; use GLTFLoader from the app? Simpler: fetch + parse via the module used by page is not exposed.
    // Instead: wing split halves were built preserving original vertex ORDER (copied per tri). We can re-weld by position and re-run union-find on the LEFT/RIGHT halves, but original cross-half adjacency is lost.
    // Simplest correct source: reload the GLB with the page's own THREE — grab constructor from an existing object.
    const av = window.__IP_AVATAR__;
    let anyMesh = null;
    av.scene.traverse((o) => { if (!anyMesh && o.isMesh) anyMesh = o; });
    const loader = new (anyMesh.constructor.prototype.constructor, null)();
    resolve('fallback');
  });
});
console.log(res);
await browser.close();
