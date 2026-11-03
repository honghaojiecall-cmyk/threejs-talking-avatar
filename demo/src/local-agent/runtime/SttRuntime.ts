import { getLocalModel, type SpeechToTextModelId } from '../modelRegistry';
import { Qwen3AsrApiRuntime } from './Qwen3AsrApiRuntime';
import { RpcWorkerClient, type WorkerProgress } from './RpcWorkerClient';

export interface SttTranscript {
  text: string;
  chunks: readonly { text: string; timestamp: [number, number] }[];
  elapsedMs: number;
}

/**
 * Speech-recognition facade: ONNX models run in the local worker while
 * server-hosted models (e.g. Qwen3-ASR) use the API runtime instead.
 */
export class SttRuntime {
  private worker: Worker | null = null;
  private client: RpcWorkerClient | null = null;
  private api: Qwen3AsrApiRuntime | null = null;
  private modelId: SpeechToTextModelId | null = null;

  async load(
    modelId: SpeechToTextModelId,
    onProgress?: (progress: WorkerProgress) => void,
  ): Promise<void> {
    if (getLocalModel(modelId).backends[0]?.runtime === 'openai-api') {
      await this.disposeWorker();
      const api = new Qwen3AsrApiRuntime();
      await api.load(modelId, onProgress);
      this.api = api;
      this.modelId = modelId;
      return;
    }
    this.api = null;
    const client = this.ensureClient();
    await client.request('load', { modelId }, [], onProgress);
    this.modelId = modelId;
  }

  async transcribe(audio: Float32Array, sampleRate = 16_000): Promise<SttTranscript> {
    if (!this.modelId) throw new Error('Install speech recognition before talking.');
    if (this.api) return this.api.transcribe(audio, sampleRate);
    const owned = new Float32Array(audio);
    return this.ensureClient().request<SttTranscript>(
      'transcribe',
      { audio: owned, sampleRate },
      [owned.buffer],
    );
  }

  async dispose(): Promise<void> {
    await this.api?.dispose();
    this.api = null;
    await this.disposeWorker();
    this.modelId = null;
  }

  private async disposeWorker(): Promise<void> {
    if (!this.client) return;
    await this.client.request('dispose').catch(() => undefined);
    this.client.terminate('Speech recognition disposed.');
    this.client = null;
    this.worker = null;
  }

  private ensureClient(): RpcWorkerClient {
    if (this.client) return this.client;
    this.worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' });
    this.client = new RpcWorkerClient(this.worker, 'Speech recognition');
    return this.client;
  }
}
