import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => console.log('CONSOLE:', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('PAGE_ERR:', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__GNM_AVATAR_DIAGNOSTICS__?.loaded === true, null, { timeout: 60000 }).catch(() => console.log('LOAD TIMEOUT'));
await page.waitForTimeout(500);
const info = await page.evaluate(() => ({
  triangles: document.body.dataset.renderTriangles,
  calls: document.body.dataset.renderCalls,
  tts: document.querySelector('#tts-model-select')?.value,
}));
console.log(info);
await browser.close();
