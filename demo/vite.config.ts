import { defineConfig, type Connect, type Plugin } from 'vite';
import { cp, copyFile, readdir, rm } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { writeThirdPartyLicenseBundle } from './scripts/write-third-party-license-bundle.mjs';

const staticBuildExcludedPaths = [
  'assets/models/gnm-neutral.glb',
  'assets/models/gnm-neutral.metadata.json',
];

const VENDOR_ASSETS_ROOT = resolve('vendor-assets');

const vendorMimeTypes: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

const serveVendorAssets: Connect.NextHandleFunction = (req, res, next) => {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/vendor/')) {
    next();
    return;
  }
  const relativePath = normalize(url.slice('/vendor/'.length));
  if (relativePath.startsWith('..')) {
    res.statusCode = 403;
    res.end();
    return;
  }
  const filePath = join(VENDOR_ASSETS_ROOT, relativePath);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader(
    'Content-Type',
    vendorMimeTypes[extname(filePath)] ?? 'application/octet-stream',
  );
  createReadStream(filePath).pipe(res);
};

const vendorAssets = {
  name: 'vendor-assets',
  configureServer(server) {
    server.middlewares.use(serveVendorAssets);
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveVendorAssets);
  },
  async closeBundle() {
    if (this.environment?.config?.command !== 'build') return;
    if (!existsSync(VENDOR_ASSETS_ROOT)) return;
    await cp(VENDOR_ASSETS_ROOT, resolve('dist', 'vendor'), { recursive: true });
  },
} satisfies Plugin;

const pruneStaticBuild = {
  name: 'prune-static-build',
  apply: 'build' as const,
  async closeBundle(): Promise<void> {
    await Promise.all([
      copyFile(resolve('..', 'LICENSE'), resolve('dist', 'LICENSE.txt')),
      copyFile(
        resolve('..', 'THIRD_PARTY_NOTICES.md'),
        resolve('dist', 'THIRD_PARTY_NOTICES.md'),
      ),
      writeThirdPartyLicenseBundle(
        resolve('dist', 'THIRD_PARTY_SOFTWARE_LICENSES.txt'),
      ),
    ]);
    await Promise.all(
      staticBuildExcludedPaths.map((path) =>
        rm(resolve('dist', path), { force: true, recursive: true }),
      ),
    );
    // onnxruntime-web emits fallback URL assets even though every runtime is
    // explicitly configured to load them from the same-origin vendor path.
    const emittedAssets = await readdir(resolve('dist', 'assets')).catch(() => []);
    await Promise.all(
      emittedAssets
        .filter((name) => name.startsWith('ort-wasm-'))
        .map((name) => rm(resolve('dist', 'assets', name), { force: true })),
    );
  },
};

export default defineConfig({
  plugins: [vendorAssets, pruneStaticBuild],
  server: {
    host: true,
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 4188,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
