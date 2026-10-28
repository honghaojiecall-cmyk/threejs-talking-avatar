import type { LanguageModelId } from '../modelRegistry';
import {
  BRAIN_SYSTEM_PROMPT_ZH,
  localBrainAbortError,
  throwIfBrainAborted,
  type BrainConversationMessage,
  type BrainGenerationOptions,
  type BrainLoadProgress,
  type LocalBrainRuntime,
} from './BrainContracts';

// gtw.phone580.com 的 CORS 头非法(Access-Control-Allow-Origin 缺少 scheme),浏览器会拦截,暂不可用:
// const DEFAULT_BASE_URL = 'https://gtw.phone580.com/v1';
// const DEFAULT_API_KEY = 'sk-jDClWr2LlZjKlCU3DDHTlsqj4dzW6wNPWe122dMtF6AXPXFC';
// const DEFAULT_MODEL = 'deepseek-v4.1-flash';

const DEFAULT_BASE_URL = 'http://100.99.56.126:3000/v1';
const DEFAULT_API_KEY = 'sk-9GMmZN9knpjW973to9mcxBgztA9Dl0hCGKi0EReXmh85HyFf';
const DEFAULT_MODEL = 'k3-256k';

const STORAGE_KEYS = {
  baseUrl: 'gnm-avatar.kimi-api-base-url.v1',
  apiKey: 'gnm-avatar.kimi-api-key.v1',
  model: 'gnm-avatar.kimi-api-model.v1',
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

/**
 * OpenAI-compatible cloud brain (Kimi K3). Streams chat completions over SSE
 * from the configured endpoint; nothing is downloaded or held in WebGPU.
 */
export class KimiApiRuntime implements LocalBrainRuntime {
  private ready = false;
  private activeController: AbortController | null = null;

  isCached(_modelId: LanguageModelId): Promise<boolean> {
    return Promise.resolve(true);
  }

  load(
    _modelId: LanguageModelId,
    onProgress?: (progress: BrainLoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfBrainAborted(signal);
    this.ready = true;
    onProgress?.({ progress: 1, text: 'Kimi K3 cloud API ready.' });
    return Promise.resolve();
  }

  async generate(
    history: readonly BrainConversationMessage[],
    options: BrainGenerationOptions,
  ): Promise<string> {
    let reply = '';
    for await (const token of this.stream(history, options.signal)) {
      reply += token;
      options.onToken(token);
    }
    return reply.trim();
  }

  async *stream(
    history: readonly BrainConversationMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, void> {
    if (!this.ready) {
      throw new Error('Install the local language model before talking.');
    }
    const baseUrl = readConfig(STORAGE_KEYS.baseUrl, DEFAULT_BASE_URL).replace(/\/+$/, '');
    const apiKey = readConfig(STORAGE_KEYS.apiKey, DEFAULT_API_KEY);
    const model = readConfig(STORAGE_KEYS.model, DEFAULT_MODEL);

    const controller = new AbortController();
    this.activeController = controller;
    const forwardAbort = (): void => controller.abort(signal?.reason ?? localBrainAbortError());
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: BRAIN_SYSTEM_PROMPT_ZH },
            ...history.slice(-8),
          ],
          stream: true,
          max_tokens: 512,
          temperature: 0.6,
          thinking: { type: 'disabled' },
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Kimi API request failed (HTTP ${response.status}): ${detail.slice(0, 300)}`);
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const chunk = JSON.parse(data) as {
              choices?: { delta?: { content?: string | null } }[];
            };
            const token = chunk.choices?.[0]?.delta?.content ?? '';
            if (token) yield token;
          } catch {
            // Ignore keep-alive comments and partial JSON frames.
          }
        }
      }
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      if (this.activeController === controller) this.activeController = null;
    }
  }

  interrupt(): void {
    this.activeController?.abort(localBrainAbortError());
    this.activeController = null;
  }

  runtimeStats(): Promise<string> {
    return Promise.resolve(
      this.ready
        ? `Kimi K3 via OpenAI-compatible API (${readConfig(STORAGE_KEYS.baseUrl, DEFAULT_BASE_URL)}).`
        : 'Local brain is not loaded.',
    );
  }

  dispose(): Promise<void> {
    this.interrupt();
    this.ready = false;
    return Promise.resolve();
  }
}
