import { env, pipeline } from '@huggingface/transformers';
import type { SpeechToTextModelId } from '../modelRegistry';
import { ONNX_WASM_BASE_URL } from './RuntimeAssetUrls';
import {
  normalizeDownloadProgress,
  postWorkerError,
  postWorkerProgress,
  postWorkerResult,
  type RpcWorkerRequest,
} from './workerProtocol';

interface LoadPayload {
  modelId: SpeechToTextModelId;
}

interface TranscribePayload {
  audio: Float32Array;
  sampleRate: number;
}

interface AsrResult {
  text: string;
  chunks?: Array<{ text: string; timestamp: [number, number] }>;
}

interface AsrPipeline {
  (audio: Float32Array, options: Record<string, unknown>): Promise<AsrResult>;
  dispose?: () => Promise<void> | void;
}

const MODEL_REPOSITORIES: Record<SpeechToTextModelId, string> = {
  'qwen3-asr-0.6b-api': '',
  'whisper-small-multilingual-q8': 'onnx-community/whisper-small',
  'whisper-tiny-multilingual-q8': 'onnx-community/whisper-tiny',
  'moonshine-tiny-q8': 'onnx-community/moonshine-tiny-ONNX',
  'whisper-tiny-en-q8': 'onnx-community/whisper-tiny.en',
};

const MULTILINGUAL_MODELS = new Set<SpeechToTextModelId>([
  'whisper-small-multilingual-q8',
  'whisper-tiny-multilingual-q8',
]);

if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = ONNX_WASM_BASE_URL;
}
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber: AsrPipeline | null = null;
let loadedModel: SpeechToTextModelId | null = null;
let queue = Promise.resolve();

async function loadModel(id: number, payload: LoadPayload): Promise<void> {
  if (transcriber && loadedModel === payload.modelId) {
    postWorkerResult(id, { modelId: payload.modelId, cached: true });
    return;
  }
  await transcriber?.dispose?.();
  transcriber = null;
  const repository = MODEL_REPOSITORIES[payload.modelId];
  if (!repository) throw new Error('API-hosted speech models do not run in the local worker.');
  const model = await pipeline(
    'automatic-speech-recognition',
    repository,
    {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (progress: unknown) => {
        postWorkerProgress(id, normalizeDownloadProgress(progress));
      },
    },
  );
  transcriber = model as unknown as AsrPipeline;
  loadedModel = payload.modelId;
  postWorkerResult(id, { modelId: payload.modelId, cached: false });
}

async function transcribe(id: number, payload: TranscribePayload): Promise<void> {
  if (!transcriber) throw new Error('Speech recognition is not installed.');
  if (!(payload.audio instanceof Float32Array) || payload.audio.length === 0) {
    throw new Error('Speech recognition received no microphone audio.');
  }
  const startedAt = performance.now();
  const multilingual = loadedModel !== null && MULTILINGUAL_MODELS.has(loadedModel);
  const result = await transcriber(payload.audio, {
    sampling_rate: payload.sampleRate,
    return_timestamps: loadedModel !== 'moonshine-tiny-q8',
    ...(multilingual ? { language: 'chinese', task: 'transcribe' } : {}),
  });
  postWorkerResult(id, {
    text: result.text.trim(),
    chunks: result.chunks ?? [],
    elapsedMs: performance.now() - startedAt,
  });
}

async function handle(message: RpcWorkerRequest): Promise<void> {
  if (message.operation === 'load') {
    await loadModel(message.id, message.payload as LoadPayload);
  } else if (message.operation === 'transcribe') {
    await transcribe(message.id, message.payload as TranscribePayload);
  } else if (message.operation === 'dispose') {
    await transcriber?.dispose?.();
    transcriber = null;
    loadedModel = null;
    postWorkerResult(message.id, undefined);
  } else {
    throw new Error(`Unknown STT worker operation: ${message.operation}`);
  }
}

globalThis.addEventListener('message', (event: MessageEvent<RpcWorkerRequest>) => {
  queue = queue.then(() => handle(event.data)).catch((error: unknown) => {
    postWorkerError(event.data.id, error);
  });
});
