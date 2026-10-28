/**
 * Version-pinned browser runtimes are served same-origin from `public/vendor`
 * (populated by scripts/copy-local-model-assets.mjs on postinstall) so the app
 * works on networks where public CDNs are unreachable.
 * Model inference and user data remain entirely in the browser.
 */
export const ONNX_WASM_BASE_URL = '/vendor/onnxruntime-web/';

export const LITERT_LM_WASM_BASE_URL = '/vendor/litert-lm/';
