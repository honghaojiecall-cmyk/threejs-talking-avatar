import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGE_ERR:', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, { timeout: 60000 });
const info = await page.evaluate(() => {
  const a = window.__MINT_AVATAR__;
  const scene = a.scene, camera = a.camera, controls = a.controls;
  const head = a.headCenter;
  // bounding box without importing THREE: traverse meshes and use geometry.boundingBox
  const meshes = [];
  scene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      meshes.push({ name: o.name, min: bb.min.toArray().map(v=>+v.toFixed(2)), max: bb.max.toArray().map(v=>+v.toFixed(2)), skinned: !!o.isSkinnedMesh, visible: o.visible, matColor: o.material?.color?.getHexString?.() });
    }
  });
  return {
    headCenter: head.toArray().map(v=>+v.toFixed(3)),
    cameraPos: camera.position.toArray().map(v=>+v.toFixed(3)),
    target: controls.target.toArray().map(v=>+v.toFixed(3)),
    drivers: [...a.drivers.keys()],
    meshes,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
