import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function copyFiles(sourceDirectory, targetDirectory, files) {
  mkdirSync(targetDirectory, { recursive: true });
  for (const file of files) {
    cpSync(join(sourceDirectory, file), join(targetDirectory, file));
  }
}

const vadDirectory = dirname(require.resolve('@ricky0123/vad-web'));
copyFiles(vadDirectory, join(projectRoot, 'public', 'local-models', 'vad'), [
  'silero_vad_v5.onnx',
  'vad.worklet.bundle.min.js',
]);

console.log('Copied the same-origin Silero VAD assets.');

const ortDist = dirname(require.resolve('onnxruntime-web'));
const ortWasmFiles = readdirSync(ortDist).filter((file) =>
  /^ort-wasm-.*\.(mjs|wasm)$/u.test(file),
);
copyFiles(ortDist, join(projectRoot, 'vendor-assets', 'onnxruntime-web'), ortWasmFiles);

console.log(`Copied ${ortWasmFiles.length} same-origin onnxruntime-web WASM assets.`);

const litertWasm = join(
  dirname(dirname(require.resolve('@litert-lm/core'))),
  'wasm',
);
const litertWasmFiles = readdirSync(litertWasm).filter((file) =>
  /\.(js|mjs|wasm)$/u.test(file),
);
copyFiles(litertWasm, join(projectRoot, 'vendor-assets', 'litert-lm'), litertWasmFiles);

console.log(`Copied ${litertWasmFiles.length} same-origin LiteRT-LM WASM assets.`);

const piperWasmDirectory = join(
  dirname(require.resolve('@diffusionstudio/piper-wasm/package.json')),
  'build',
);
copyFiles(piperWasmDirectory, join(projectRoot, 'vendor-assets', 'piper'), [
  'piper_phonemize.data',
  'piper_phonemize.js',
  'piper_phonemize.wasm',
]);

console.log('Copied the same-origin Piper phonemize WASM assets.');
