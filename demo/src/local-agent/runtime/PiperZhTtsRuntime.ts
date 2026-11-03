import type { TextToSpeechModelId } from '../modelRegistry';
import type { LocalTtsSynthesisResult } from './LocalTtsTypes';
import { chineseTextToIpa } from './PinyinPhonemes';
import { ONNX_WASM_BASE_URL } from './RuntimeAssetUrls';
import type { WorkerProgress } from './RpcWorkerClient';
import { normalizeDownloadProgress } from './workerProtocol';

const PIPER_MODEL_VOICES: Partial<Record<TextToSpeechModelId, string>> = {
  'piper-zh-huayan-medium-wasm': 'zh_CN-huayan-medium',
};

export function isPiperTtsModelId(modelId: TextToSpeechModelId): boolean {
  return modelId in PIPER_MODEL_VOICES;
}

/**
 * piper-tts-web hardcodes CDN bases that are unreliable (cdnjs is missing the
 * onnxruntime .mjs glue, jsDelivr intermittently drops the phonemize wasm), so
 * all WASM assets are vendored under /vendor/piper/. TtsSession.WASM_LOCATIONS
 * is the same object used as the session defaults, so mutating it before the
 * first session is created redirects every fetch.
 */
const HF_VOICES_BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';

let fetchInterceptorInstalled = false;

/**
 * huggingface.co is unreachable from some networks, so voice models are also
 * vendored under /vendor/piper/voices/ and requests to the HF base are
 * rewritten to the local copies.
 */
function installVoiceFetchInterceptor(): void {
  if (fetchInterceptorInstalled) return;
  fetchInterceptorInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${HF_VOICES_BASE}/`)) {
      const path = url.slice(HF_VOICES_BASE.length + 1);
      return originalFetch(`/vendor/piper/voices/${path}`, init);
    }
    return originalFetch(input as RequestInfo, init);
  };
}

async function useVendoredWasmPaths(): Promise<void> {
  installVoiceFetchInterceptor();
  const { TtsSession } = await import('@mintplex-labs/piper-tts-web');
  const base = `${window.location.origin}/vendor/piper`;
  TtsSession.WASM_LOCATIONS.onnxWasm =
    `${window.location.origin}${ONNX_WASM_BASE_URL}`;
  TtsSession.WASM_LOCATIONS.piperData = `${base}/piper_phonemize.data`;
  TtsSession.WASM_LOCATIONS.piperWasm = `${base}/piper_phonemize.wasm`;
}

function decodeWavPcm(buffer: ArrayBuffer): { audio: Float32Array; sampleRate: number } {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 ||
    String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'RIFF') {
    throw new Error('Piper returned an invalid WAV payload.');
  }
  let channels = 1;
  let sampleRate = 22_050;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(chunkSize, buffer.byteLength - dataOffset);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataOffset < 0 || dataLength <= 0) {
    throw new Error('Piper WAV payload has no audio data chunk.');
  }

  const frameCount = Math.floor(dataLength / (bitsPerSample / 8) / Math.max(1, channels));
  const audio = new Float32Array(frameCount);
  if (bitsPerSample === 16) {
    const pcm = new Int16Array(buffer, dataOffset, frameCount * channels);
    for (let frame = 0; frame < frameCount; frame += 1) {
      audio[frame] = pcm[frame * channels] / 32_768;
    }
  } else if (bitsPerSample === 32) {
    const pcm = new Float32Array(buffer, dataOffset, frameCount * channels);
    for (let frame = 0; frame < frameCount; frame += 1) {
      audio[frame] = pcm[frame * channels];
    }
  } else {
    throw new Error(`Unsupported Piper WAV bit depth: ${bitsPerSample}.`);
  }
  return { audio, sampleRate };
}

/**
 * Mandarin Piper (VITS) voice served by @mintplex-labs/piper-tts-web. The
 * library manages its own inference worker and OPFS model cache, so this
 * runtime stays on the main thread. Lip timing is reconstructed from pinyin
 * articulation, then refined by the waveform timing modes.
 */
export class PiperZhTtsRuntime {
  private modelId: TextToSpeechModelId | null = null;
  private cancelled = false;

  async load(
    modelId: TextToSpeechModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    const voiceId = this.voiceId(modelId);
    await useVendoredWasmPaths();
    const { download, predict } = await import('@mintplex-labs/piper-tts-web');
    await download(voiceId, (progress) =>
      onProgress?.(normalizeDownloadProgress(progress)),
    );
    // Compile the WASM session and run a first inference during installation.
    await predict({ text: '你好。', voiceId });
    this.modelId = modelId;
  }

  async synthesize(text: string): Promise<LocalTtsSynthesisResult> {
    if (!this.modelId) throw new Error('Install the Piper voice before starting a conversation.');
    const voiceId = this.voiceId(this.modelId);
    this.cancelled = false;
    const startedAt = performance.now();
    const { predict } = await import('@mintplex-labs/piper-tts-web');
    const blob = await predict({ text, voiceId });
    if (this.cancelled) {
      throw new DOMException('Piper synthesis interrupted.', 'AbortError');
    }
    const { audio, sampleRate } = decodeWavPcm(await blob.arrayBuffer());
    const phonemes = chineseTextToIpa(text);
    const elapsedMs = performance.now() - startedAt;
    const audioDurationSeconds = audio.length / sampleRate;
    return {
      engine: 'piper-zh',
      backend: 'wasm',
      preset: 'standard',
      chunks: [{ text, phonemes, audio, sampleRate }],
      elapsedMs,
      audioDurationSeconds,
      realTimeFactor: elapsedMs / Math.max(1, audioDurationSeconds * 1000),
    };
  }

  cancelInFlight(): void {
    this.cancelled = true;
  }

  dispose(): Promise<void> {
    this.cancelled = true;
    this.modelId = null;
    return Promise.resolve();
  }

  private voiceId(modelId: TextToSpeechModelId): string {
    const voiceId = PIPER_MODEL_VOICES[modelId];
    if (!voiceId) throw new Error(`Unsupported Piper voice model: ${modelId}.`);
    return voiceId;
  }
}
