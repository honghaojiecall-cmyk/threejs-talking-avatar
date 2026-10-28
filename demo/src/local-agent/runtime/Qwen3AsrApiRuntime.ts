import type { SpeechToTextModelId } from '../modelRegistry';
import type { SttTranscript } from './SttRuntime';
import type { WorkerProgress } from './RpcWorkerClient';

const DEFAULT_BASE_URL = 'http://100.119.69.55:8000/v1';
const DEFAULT_MODEL = 'Qwen/Qwen3-ASR-0.6B';

const STORAGE_KEYS = {
  baseUrl: 'gnm-avatar.qwen3-asr-base-url.v1',
  model: 'gnm-avatar.qwen3-asr-model.v1',
} as const;

function readConfig(key: (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS], fallback: string): string {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (typeof stored === 'string' && stored.trim().length > 0) return stored.trim();
  } catch {
    // Storage may be blocked; fall back to the compiled default.
  }
  return fallback;
}

function encodeWavPcm16(audio: Float32Array, sampleRate: number): Blob {
  const frameCount = audio.length;
  const buffer = new ArrayBuffer(44 + frameCount * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + frameCount * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, frameCount * 2, true);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.max(-1, Math.min(1, audio[frame]));
    view.setInt16(44 + frame * 2, Math.round(sample * 32_767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function stripServerPrefix(text: string): string {
  return text
    .replace(/^\s*language\s+\S+\s*<asr_text>\s*/u, '')
    .replace(/^\s*<asr_text>\s*/u, '')
    .trim();
}

/**
 * Server-hosted Qwen3-ASR through an OpenAI-compatible transcription endpoint.
 * The browser only ships the captured utterance; no model is downloaded.
 */
export class Qwen3AsrApiRuntime {
  private ready = false;

  async load(
    _modelId: SpeechToTextModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    const baseUrl = readConfig(STORAGE_KEYS.baseUrl, DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = readConfig(STORAGE_KEYS.model, DEFAULT_MODEL);
    const response = await fetch(`${baseUrl}/models`);
    if (!response.ok) {
      throw new Error(`Qwen3-ASR 服务端不可达(HTTP ${response.status})。`);
    }
    this.ready = true;
    onProgress?.({
      loadedBytes: 0,
      totalBytes: null,
      fraction: 1,
      file: null,
      message: `服务端 ${model} 已就绪`,
    });
  }

  async transcribe(audio: Float32Array, sampleRate = 16_000): Promise<SttTranscript> {
    if (!this.ready) throw new Error('Install speech recognition before talking.');
    if (audio.length === 0) throw new Error('Speech recognition received no microphone audio.');
    const startedAt = performance.now();
    const baseUrl = readConfig(STORAGE_KEYS.baseUrl, DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = readConfig(STORAGE_KEYS.model, DEFAULT_MODEL);
    const form = new FormData();
    form.append('file', encodeWavPcm16(audio, sampleRate), 'utterance.wav');
    form.append('model', model);
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Qwen3-ASR 识别请求失败(HTTP ${response.status}):${detail.slice(0, 300)}`);
    }
    const body = await response.json() as { text?: unknown };
    return {
      text: typeof body.text === 'string' ? stripServerPrefix(body.text) : '',
      chunks: [],
      elapsedMs: performance.now() - startedAt,
    };
  }

  dispose(): Promise<void> {
    this.ready = false;
    return Promise.resolve();
  }
}
