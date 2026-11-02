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

// gtw.phone580.com 的 CORS 头非法(Access-Control-Allow-Origin 缺少 scheme),浏览器直连会被拦截,
// 且每月 token 配额有限——默认走 vite dev server 的 /llm-api 代理(见 vite.config.ts)。
// 如需切换端点/密钥/模型,可在 localStorage 覆盖 gnm-avatar.kimi-api-* 三个键。
const DEFAULT_BASE_URL = '/llm-api/v1';
const DEFAULT_API_KEY = 'sk-jDClWr2LlZjKlCU3DDHTlsqj4dzW6wNPWe122dMtF6AXPXFC';
const DEFAULT_MODEL = 'deepseek-v4.1-flash';

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
    onProgress?.({ progress: 1, text: 'Cloud LLM API ready.' });
    // Warm the HTTP connection and upstream path (TCP/TLS + proxy + model
    // routing) so the first real turn is not paying cold-start latency for
    // time-to-first-token. Best-effort: never block loading on it.
    void this.warmup().catch(() => {});
    return Promise.resolve();
  }

  /** Fire a minimal streaming request and discard the body. */
  private async warmup(): Promise<void> {
    const baseUrl = readConfig(STORAGE_KEYS.baseUrl, DEFAULT_BASE_URL).replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readConfig(STORAGE_KEYS.apiKey, DEFAULT_API_KEY)}`,
      },
      body: JSON.stringify({
        model: readConfig(STORAGE_KEYS.model, DEFAULT_MODEL),
        messages: [{ role: 'user', content: 'ping' }],
        stream: true,
        max_tokens: 1,
      }),
    });
    await response.body?.cancel();
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

    // The gateway load-balances across upstream keys whose quotas expire at
    // different times — roughly half of the channels currently answer 429
    // immediately. Dead channels fail fast, so retry quickly and often; with
    // ~50% dead odds, 6 attempts leave <2% of turns failing.
    const MAX_ATTEMPTS = 6;
    const RETRY_DELAY_MS = 400;

    try {
      for (let attempt = 1; ; attempt++) {
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
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
          if (controller.signal.aborted) throw localBrainAbortError();
          continue;
        }
        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Kimi API request failed (HTTP ${response.status}): ${detail.slice(0, 300)}`);
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        // Abort with a plain (non-AbortError) reason if the stream stalls, so the
        // agent surfaces a real error instead of silently dropping the turn.
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const armIdleTimer = (): void => {
          if (idleTimer !== undefined) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            controller.abort(new Error('云端 LLM 流式响应中断(30 秒无数据)。'));
          }, 30_000);
        };
        let buffer = '';
        try {
          armIdleTimer();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            armIdleTimer();
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
          return;
        } finally {
          if (idleTimer !== undefined) clearTimeout(idleTimer);
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
        ? `Cloud LLM via OpenAI-compatible API (${readConfig(STORAGE_KEYS.baseUrl, DEFAULT_BASE_URL)}).`
        : 'Local brain is not loaded.',
    );
  }

  dispose(): Promise<void> {
    this.interrupt();
    this.ready = false;
    return Promise.resolve();
  }
}
