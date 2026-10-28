import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('[error]', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:5188/', { waitUntil: 'domcontentloaded' });
const result = await page.evaluate(async () => {
  const { PiperZhTtsRuntime } = await import('/src/local-agent/runtime/PiperZhTtsRuntime.ts');
  const rt = new PiperZhTtsRuntime();
  await rt.load('piper-zh-huayan-medium-wasm');
  const out = await rt.synthesize('你好，我是你的中文语音助手。');
  const chunk = out.chunks[0];
  return {
    engine: out.engine,
    elapsedMs: Math.round(out.elapsedMs),
    audioDurationSeconds: Number(out.audioDurationSeconds.toFixed(2)),
    sampleRate: chunk.sampleRate,
    samples: chunk.audio.length,
    phonemes: chunk.phonemes.slice(0, 60),
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
