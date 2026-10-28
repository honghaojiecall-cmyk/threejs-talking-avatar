export type LocalModelKind = 'stt' | 'llm' | 'tts';

export type LocalExecutionBackend = 'wasm' | 'webgpu' | 'api';

export type LocalModelRuntime =
  | 'onnx-runtime-web'
  | 'transformers-js'
  | 'litert-lm'
  | 'webllm'
  | 'openai-api'
  | 'piper-wasm';

export type LocalModelPrecision = 'q8' | 'q4' | 'q4f16' | 'fp32';

export type LocalModelCapability = 'wasm' | 'webgpu' | 'shader-f16';

export type LocalModelReleaseChannel =
  | 'safe-default'
  | 'optional'
  | 'experimental';

export type DownloadSizeConfidence = 'artifact-listing' | 'estimate';

export interface LocalModelLicense {
  /** Null when the license is not represented by an SPDX identifier. */
  spdxId: 'Apache-2.0' | 'MIT' | null;
  name: string;
  url: string;
  requiresAcceptance: boolean;
}

export interface LocalModelArtifact {
  /** Stable upstream repository identifier. It is metadata, not a fetch URL. */
  repository: string;
  /** Runtime-specific artifact/config identifier planned for the downloader. */
  artifactId: string;
  estimatedDownloadBytes: number;
  downloadSizeConfidence: DownloadSizeConfidence;
  /** Must be pinned before a production downloader is enabled. */
  revision: string | null;
}

export interface LocalModelBackendProfile {
  runtime: LocalModelRuntime;
  execution: LocalExecutionBackend;
  precision: LocalModelPrecision;
  requiredCapabilities: readonly LocalModelCapability[];
}

export interface LocalModelPolicy {
  releaseChannel: LocalModelReleaseChannel;
  allowAutomaticDownload: boolean;
  requiresExplicitConsent: boolean;
  warning?: string;
}

interface LocalModelDescriptorBase {
  id: LocalModelId;
  kind: LocalModelKind;
  displayName: string;
  description: string;
  artifact: LocalModelArtifact;
  backends: readonly LocalModelBackendProfile[];
  license: LocalModelLicense;
  policy: LocalModelPolicy;
}

export interface SpeechToTextModelDescriptor extends LocalModelDescriptorBase {
  kind: 'stt';
  id: SpeechToTextModelId;
  languageSupport: 'english' | 'multilingual';
  streaming: boolean;
}

export interface LanguageModelDescriptor extends LocalModelDescriptorBase {
  kind: 'llm';
  id: LanguageModelId;
  contextWindowTokens: number;
  multimodal: boolean;
}

export interface TextToSpeechModelDescriptor extends LocalModelDescriptorBase {
  kind: 'tts';
  id: TextToSpeechModelId;
  voices: 'kokoro' | 'supertonic' | 'kitten' | 'piper';
  producesNativeVisemeTiming: boolean;
}

export type LocalModelDescriptor =
  | SpeechToTextModelDescriptor
  | LanguageModelDescriptor
  | TextToSpeechModelDescriptor;

export const SPEECH_TO_TEXT_MODEL_IDS = [
  'qwen3-asr-0.6b-api',
  'whisper-small-multilingual-q8',
  'whisper-tiny-multilingual-q8',
  'moonshine-tiny-q8',
  'whisper-tiny-en-q8',
] as const;

export const LANGUAGE_MODEL_IDS = [
  'kimi-k3-256k-api',
  'qwen2.5-0.5b-instruct-q4f16',
  'qwen3.5-0.8b-q4f16',
  'qwen3.5-2b-q4f16',
  'qwen3.5-4b-q4f16',
  'gemma-4-e2b-it-litert-web',
  'gemma-4-e4b-it-litert-web',
  'gemma-3-1b-it-q4f16',
] as const;

export const TEXT_TO_SPEECH_MODEL_IDS = [
  'piper-zh-huayan-medium-wasm',
  'kokoro-82m-q8-wasm',
  'kokoro-82m-fp32-webgpu',
  'kokoro-82m-timestamped-q8-wasm',
  'kokoro-82m-timestamped-fp32-webgpu',
  'supertonic-2-instant-webgpu',
  'supertonic-2-quality-webgpu',
  'kitten-tts-nano-0.8-fp32-webgpu',
] as const;

export type SpeechToTextModelId = (typeof SPEECH_TO_TEXT_MODEL_IDS)[number];
export type LanguageModelId = (typeof LANGUAGE_MODEL_IDS)[number];
export type TextToSpeechModelId = (typeof TEXT_TO_SPEECH_MODEL_IDS)[number];
export type LocalModelId =
  | SpeechToTextModelId
  | LanguageModelId
  | TextToSpeechModelId;

// Upstream artifact listings report decimal MB/GB; preserve that convention.
const MB = 1_000_000;

const MIT_LICENSE: LocalModelLicense = {
  spdxId: 'MIT',
  name: 'MIT License',
  url: 'https://opensource.org/license/mit',
  requiresAcceptance: false,
};

const APACHE_2_LICENSE: LocalModelLicense = {
  spdxId: 'Apache-2.0',
  name: 'Apache License 2.0',
  url: 'https://www.apache.org/licenses/LICENSE-2.0',
  requiresAcceptance: false,
};

const GEMMA_TERMS: LocalModelLicense = {
  spdxId: null,
  name: 'Gemma Terms of Use',
  url: 'https://ai.google.dev/gemma/terms',
  requiresAcceptance: true,
};

const OPENRAIL_M_LICENSE: LocalModelLicense = {
  spdxId: null,
  name: 'OpenRAIL-M License',
  url: 'https://huggingface.co/Supertone/supertonic-2/blob/75e6727618a02f323c720cba9478152d4bc16ca4/LICENSE',
  requiresAcceptance: false,
};

const WASM_Q8_ONNX = [
  {
    runtime: 'onnx-runtime-web',
    execution: 'wasm',
    precision: 'q8',
    requiredCapabilities: ['wasm'],
  },
] as const satisfies readonly LocalModelBackendProfile[];

const WEBGPU_Q4F16_WEBLLM = [
  {
    runtime: 'webllm',
    execution: 'webgpu',
    precision: 'q4f16',
    requiredCapabilities: ['webgpu', 'shader-f16'],
  },
] as const satisfies readonly LocalModelBackendProfile[];

const WEBGPU_Q4F16_TRANSFORMERS = [
  {
    runtime: 'transformers-js',
    execution: 'webgpu',
    precision: 'q4f16',
    requiredCapabilities: ['webgpu', 'shader-f16'],
  },
] as const satisfies readonly LocalModelBackendProfile[];

const OPENAI_COMPATIBLE_API = [
  {
    runtime: 'openai-api',
    execution: 'api',
    precision: 'fp32',
    requiredCapabilities: [],
  },
] as const satisfies readonly LocalModelBackendProfile[];

const MOONSHOT_API_LICENSE: LocalModelLicense = {
  spdxId: null,
  name: 'Moonshot Platform Terms of Service',
  url: 'https://platform.moonshot.ai/',
  requiresAcceptance: false,
};

const WEBGPU_Q4_LITERT_LM = [
  {
    runtime: 'litert-lm',
    execution: 'webgpu',
    precision: 'q4',
    requiredCapabilities: ['webgpu'],
  },
] as const satisfies readonly LocalModelBackendProfile[];

export const SPEECH_TO_TEXT_MODELS = {
  'qwen3-asr-0.6b-api': {
    id: 'qwen3-asr-0.6b-api',
    kind: 'stt',
    displayName: 'Qwen3-ASR 0.6B(服务端)',
    description: '服务端 vLLM 托管的 Qwen3-ASR 0.6B,中文识别质量最佳;浏览器只上传语音,无需下载模型。',
    artifact: {
      repository: 'Qwen/Qwen3-ASR-0.6B',
      artifactId: 'qwen3-asr-0.6b-vllm',
      estimatedDownloadBytes: 0,
      downloadSizeConfidence: 'estimate',
      revision: null,
    },
    backends: OPENAI_COMPATIBLE_API,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'safe-default',
      allowAutomaticDownload: true,
      requiresExplicitConsent: false,
    },
    languageSupport: 'multilingual',
    streaming: false,
  },
  'whisper-small-multilingual-q8': {
    id: 'whisper-small-multilingual-q8',
    kind: 'stt',
    displayName: 'Whisper Small Multilingual q8',
    description: '多语言识别(中文及其他 98 种语言),较 Tiny 明显提升中文准确率,代价是更大的下载与内存占用。',
    artifact: {
      repository: 'onnx-community/whisper-small',
      artifactId: 'whisper-small-multilingual-q8-onnx',
      estimatedDownloadBytes: 249 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: null,
    },
    backends: WASM_Q8_ONNX,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'safe-default',
      allowAutomaticDownload: true,
      requiresExplicitConsent: false,
    },
    languageSupport: 'multilingual',
    streaming: false,
  },
  'whisper-tiny-multilingual-q8': {
    id: 'whisper-tiny-multilingual-q8',
    kind: 'stt',
    displayName: 'Whisper Tiny Multilingual q8',
    description: '多语言识别(中文及其他 98 种语言),用于中文对话路径。',
    artifact: {
      repository: 'onnx-community/whisper-tiny',
      artifactId: 'whisper-tiny-multilingual-q8-onnx',
      estimatedDownloadBytes: 42 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: null,
    },
    backends: WASM_Q8_ONNX,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'safe-default',
      allowAutomaticDownload: true,
      requiresExplicitConsent: false,
    },
    languageSupport: 'multilingual',
    streaming: false,
  },
  'moonshine-tiny-q8': {
    id: 'moonshine-tiny-q8',
    kind: 'stt',
    displayName: 'Moonshine Tiny q8',
    description: '低延迟英文语音识别,适用于安全的本地路径。',
    artifact: {
      repository: 'onnx-community/moonshine-tiny-ONNX',
      artifactId: 'moonshine-tiny-q8-onnx',
      estimatedDownloadBytes: 34 * MB,
      downloadSizeConfidence: 'estimate',
      revision: null,
    },
    backends: WASM_Q8_ONNX,
    license: MIT_LICENSE,
    policy: {
      releaseChannel: 'safe-default',
      allowAutomaticDownload: true,
      requiresExplicitConsent: false,
    },
    languageSupport: 'english',
    streaming: false,
  },
  'whisper-tiny-en-q8': {
    id: 'whisper-tiny-en-q8',
    kind: 'stt',
    displayName: 'Whisper Tiny.en q8',
    description: '英文识别回退,生态支持更广。',
    artifact: {
      repository: 'onnx-community/whisper-tiny.en',
      artifactId: 'whisper-tiny-en-q8-onnx',
      estimatedDownloadBytes: 42 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: null,
    },
    backends: WASM_Q8_ONNX,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
    },
    languageSupport: 'english',
    streaming: false,
  },
} as const satisfies Record<SpeechToTextModelId, SpeechToTextModelDescriptor>;

export const LANGUAGE_MODELS = {
  'kimi-k3-256k-api': {
    id: 'kimi-k3-256k-api',
    kind: 'llm',
    displayName: 'Kimi K3 256K (Cloud API)',
    description:
      'Moonshot Kimi K3,通过 OpenAI 兼容接口提供。无需本地下载或 GPU 显存;需要能访问所配置的 API 主机。',
    artifact: {
      repository: 'moonshotai/kimi-k3',
      artifactId: 'kimi-k3-256k',
      estimatedDownloadBytes: 0,
      downloadSizeConfidence: 'estimate',
      revision: null,
    },
    backends: OPENAI_COMPATIBLE_API,
    license: MOONSHOT_API_LICENSE,
    policy: {
      releaseChannel: 'safe-default',
      allowAutomaticDownload: true,
      requiresExplicitConsent: false,
    },
    contextWindowTokens: 262_144,
    multimodal: false,
  },
  'qwen2.5-0.5b-instruct-q4f16': {
    id: 'qwen2.5-0.5b-instruct-q4f16',
    kind: 'llm',
    displayName: 'Qwen2.5 0.5B Instruct',
    description: '快速、紧凑的 WebLLM 模型,适用于安全的本地路径。',
    artifact: {
      repository: 'mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      artifactId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      estimatedDownloadBytes: 290 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: null,
    },
    backends: WEBGPU_Q4F16_WEBLLM,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'safe-default',
      allowAutomaticDownload: true,
      requiresExplicitConsent: false,
    },
    contextWindowTokens: 32_768,
    multimodal: false,
  },
  'qwen3.5-0.8b-q4f16': {
    id: 'qwen3.5-0.8b-q4f16',
    kind: 'llm',
    displayName: 'Qwen3.5 0.8B',
    description: '更新的 WebLLM 质量选项;绝不会被隐式选中或下载。',
    artifact: {
      repository: 'mlc-ai/Qwen3.5-0.8B-q4f16_1-MLC',
      artifactId: 'Qwen3.5-0.8B-q4f16_1-MLC',
      estimatedDownloadBytes: 447 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: null,
    },
    backends: WEBGPU_Q4F16_WEBLLM,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
    },
    contextWindowTokens: 262_144,
    multimodal: false,
  },
  'qwen3.5-2b-q4f16': {
    id: 'qwen3.5-2b-q4f16',
    kind: 'llm',
    displayName: 'Qwen3.5 2B',
    description: '均衡的 WebLLM 选项,相比十亿参数以下的模型有明显质量提升。',
    artifact: {
      repository: 'mlc-ai/Qwen3.5-2B-q4f16_1-MLC',
      artifactId: 'Qwen3.5-2B-q4f16_1-MLC',
      estimatedDownloadBytes: 1_080 * MB,
      downloadSizeConfidence: 'estimate',
      revision: null,
    },
    backends: WEBGPU_Q4F16_WEBLLM,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
    },
    contextWindowTokens: 262_144,
    multimodal: false,
  },
  'qwen3.5-4b-q4f16': {
    id: 'qwen3.5-4b-q4f16',
    kind: 'llm',
    displayName: 'Qwen3.5 4B',
    description: '更高质量的 WebLLM 选项,适合约有 4 GB 空闲显存的设备。',
    artifact: {
      repository: 'mlc-ai/Qwen3.5-4B-q4f16_1-MLC',
      artifactId: 'Qwen3.5-4B-q4f16_1-MLC',
      estimatedDownloadBytes: 1_590 * MB,
      downloadSizeConfidence: 'estimate',
      revision: null,
    },
    backends: WEBGPU_Q4F16_WEBLLM,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
      warning:
        '需要约 3.9 GB 的 WebGPU 显存,可能与渲染和语音合成争抢资源。',
    },
    contextWindowTokens: 262_144,
    multimodal: false,
  },
  'gemma-4-e2b-it-litert-web': {
    id: 'gemma-4-e2b-it-litert-web',
    kind: 'llm',
    displayName: 'Gemma 4 E2B IT',
    description: '推荐的智能本地模型,基于 Google LiteRT-LM WebGPU 运行。',
    artifact: {
      repository: 'litert-community/gemma-4-E2B-it-litert-lm',
      artifactId: 'gemma-4-E2B-it-web.litertlm',
      estimatedDownloadBytes: 2_010 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: '9262660a1676eed6d0c477ab1a86344430854664',
    },
    backends: WEBGPU_Q4_LITERT_LM,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
      warning:
        '首次下载约 2 GB。初始化期间请保持其他高显存模型处于卸载状态。',
    },
    contextWindowTokens: 131_072,
    multimodal: false,
  },
  'gemma-4-e4b-it-litert-web': {
    id: 'gemma-4-e4b-it-litert-web',
    kind: 'llm',
    displayName: 'Gemma 4 E4B IT',
    description: '质量最高的 Gemma 浏览器选项,显存占用与延迟也明显更高。',
    artifact: {
      repository: 'litert-community/gemma-4-E4B-it-litert-lm',
      artifactId: 'gemma-4-E4B-it-web.litertlm',
      estimatedDownloadBytes: 2_970 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: 'f7ad3343bd6ebc9607f4dc3bc4f2398bd5749bc5',
    },
    backends: WEBGPU_Q4_LITERT_LM,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'experimental',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
      warning:
        '首次下载约 3 GB,GPU 显存压力较大;可能干扰渲染或导致 WebGPU 设备丢失。',
    },
    contextWindowTokens: 131_072,
    multimodal: false,
  },
  'gemma-3-1b-it-q4f16': {
    id: 'gemma-3-1b-it-q4f16',
    kind: 'llm',
    displayName: 'Gemma 3 1B IT',
    description: '可选的紧凑型 Gemma 对比模型。',
    artifact: {
      repository: 'onnx-community/gemma-3-1b-it-ONNX',
      artifactId: 'gemma-3-1b-it-q4f16-onnx',
      estimatedDownloadBytes: 783 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: null,
    },
    backends: WEBGPU_Q4F16_TRANSFORMERS,
    license: GEMMA_TERMS,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: true,
    },
    contextWindowTokens: 32_768,
    multimodal: false,
  },
} as const satisfies Record<LanguageModelId, LanguageModelDescriptor>;

export const TEXT_TO_SPEECH_MODELS = {
  'piper-zh-huayan-medium-wasm': {
    id: 'piper-zh-huayan-medium-wasm',
    kind: 'tts',
    displayName: 'Piper 中文 Huayan (WASM)',
    description: '完全在浏览器中运行的中文普通话 VITS 语音;唇形时序由拼音发音与波形能量估计。',
    artifact: {
      repository: 'diffusionstudio/piper-voices',
      artifactId: 'zh_CN-huayan-medium',
      estimatedDownloadBytes: 63 * MB,
      downloadSizeConfidence: 'estimate',
      revision: null,
    },
    backends: [
      {
        runtime: 'piper-wasm',
        execution: 'wasm',
        precision: 'fp32',
        requiredCapabilities: ['wasm'],
      },
    ],
    license: MIT_LICENSE,
    policy: {
      releaseChannel: 'safe-default',
      allowAutomaticDownload: true,
      requiresExplicitConsent: false,
    },
    voices: 'piper',
    producesNativeVisemeTiming: false,
  },
  'kokoro-82m-q8-wasm': {
    id: 'kokoro-82m-q8-wasm',
    kind: 'tts',
    displayName: 'Kokoro 82M q8 (WASM)',
    description: 'CPU/WASM 语音合成,把 GPU 留给面部和大模型。',
    artifact: {
      repository: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      artifactId: 'kokoro-82m-q8-onnx',
      estimatedDownloadBytes: 92 * MB,
      downloadSizeConfidence: 'estimate',
      revision: null,
    },
    backends: WASM_Q8_ONNX,
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'safe-default',
      allowAutomaticDownload: true,
      requiresExplicitConsent: false,
    },
    voices: 'kokoro',
    producesNativeVisemeTiming: false,
  },
  'kokoro-82m-fp32-webgpu': {
    id: 'kokoro-82m-fp32-webgpu',
    kind: 'tts',
    displayName: 'Kokoro 82M fp32 (WebGPU)',
    description: '可选的合成路径,适合有空闲显存的设备。',
    artifact: {
      repository: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      artifactId: 'kokoro-82m-fp32-onnx',
      estimatedDownloadBytes: 326 * MB,
      downloadSizeConfidence: 'estimate',
      revision: null,
    },
    backends: [
      {
        runtime: 'onnx-runtime-web',
        execution: 'webgpu',
        precision: 'fp32',
        requiredCapabilities: ['webgpu'],
      },
    ],
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
    },
    voices: 'kokoro',
    producesNativeVisemeTiming: false,
  },
  'kokoro-82m-timestamped-q8-wasm': {
    id: 'kokoro-82m-timestamped-q8-wasm',
    kind: 'tts',
    displayName: 'Kokoro Timestamped q8 (WASM)',
    description: 'CPU 合成,带用于构建自身波形的逐 token 时长。',
    artifact: {
      repository: 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped',
      artifactId: 'kokoro-82m-timestamped-q8-onnx',
      estimatedDownloadBytes: 92.4 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: null,
    },
    backends: [
      {
        runtime: 'transformers-js',
        execution: 'wasm',
        precision: 'q8',
        requiredCapabilities: ['wasm'],
      },
    ],
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
    },
    voices: 'kokoro',
    producesNativeVisemeTiming: true,
  },
  'kokoro-82m-timestamped-fp32-webgpu': {
    id: 'kokoro-82m-timestamped-fp32-webgpu',
    kind: 'tts',
    displayName: 'Kokoro Timestamped fp32',
    description: '推荐的唇形同步路径:WebGPU Kokoro,带合成原生音素时长。',
    artifact: {
      repository: 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped',
      artifactId: 'kokoro-82m-timestamped-fp32-onnx',
      estimatedDownloadBytes: 326 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: null,
    },
    backends: [
      {
        runtime: 'transformers-js',
        execution: 'webgpu',
        precision: 'fp32',
        requiredCapabilities: ['webgpu'],
      },
    ],
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
      warning: '与面部和本地大脑共用 WebGPU;若适配器显存不足,请卸载更大的模型。',
    },
    voices: 'kokoro',
    producesNativeVisemeTiming: true,
  },
  'supertonic-2-instant-webgpu': {
    id: 'supertonic-2-instant-webgpu',
    kind: 'tts',
    displayName: 'Supertonic 2 Instant',
    description: '两步低延迟合成,支持 WebGPU 并自动回退 WASM。',
    artifact: {
      repository: 'Supertone/supertonic-2',
      artifactId: 'supertonic-2-onnx',
      estimatedDownloadBytes: 263 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: '75e6727618a02f323c720cba9478152d4bc16ca4',
    },
    backends: [
      {
        runtime: 'onnx-runtime-web',
        execution: 'webgpu',
        precision: 'fp32',
        requiredCapabilities: ['webgpu'],
      },
      {
        runtime: 'onnx-runtime-web',
        execution: 'wasm',
        precision: 'fp32',
        requiredCapabilities: ['wasm'],
      },
    ],
    license: OPENRAIL_M_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
    },
    voices: 'supertonic',
    producesNativeVisemeTiming: false,
  },
  'supertonic-2-quality-webgpu': {
    id: 'supertonic-2-quality-webgpu',
    kind: 'tts',
    displayName: 'Supertonic 2 Quality',
    description: '五步高质量合成,支持 WebGPU 并自动回退 WASM。',
    artifact: {
      repository: 'Supertone/supertonic-2',
      artifactId: 'supertonic-2-onnx',
      estimatedDownloadBytes: 263 * MB,
      downloadSizeConfidence: 'artifact-listing',
      revision: '75e6727618a02f323c720cba9478152d4bc16ca4',
    },
    backends: [
      {
        runtime: 'onnx-runtime-web',
        execution: 'webgpu',
        precision: 'fp32',
        requiredCapabilities: ['webgpu'],
      },
      {
        runtime: 'onnx-runtime-web',
        execution: 'wasm',
        precision: 'fp32',
        requiredCapabilities: ['wasm'],
      },
    ],
    license: OPENRAIL_M_LICENSE,
    policy: {
      releaseChannel: 'optional',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
    },
    voices: 'supertonic',
    producesNativeVisemeTiming: false,
  },
  'kitten-tts-nano-0.8-fp32-webgpu': {
    id: 'kitten-tts-nano-0.8-fp32-webgpu',
    kind: 'tts',
    displayName: 'KittenTTS Nano 0.8',
    description: '极小的单遍 15M 参数语音,用于最快的低显存对比路径。',
    artifact: {
      repository: 'KittenML/kitten-tts-nano-0.8-fp32',
      artifactId: 'kitten-tts-nano-v0.8-fp32-onnx',
      estimatedDownloadBytes: 60_045_997,
      downloadSizeConfidence: 'artifact-listing',
      revision: '7a1db645b1f3ab9420761d87428e042b9cec3f26',
    },
    backends: [
      {
        runtime: 'onnx-runtime-web',
        execution: 'webgpu',
        precision: 'fp32',
        requiredCapabilities: ['webgpu'],
      },
      {
        runtime: 'onnx-runtime-web',
        execution: 'wasm',
        precision: 'fp32',
        requiredCapabilities: ['wasm'],
      },
    ],
    license: APACHE_2_LICENSE,
    policy: {
      releaseChannel: 'experimental',
      allowAutomaticDownload: false,
      requiresExplicitConsent: false,
      warning: 'KittenTTS 0.8 为开发者预览版;选用前请先对比其发音与音质。',
    },
    voices: 'kitten',
    producesNativeVisemeTiming: false,
  },
} as const satisfies Record<TextToSpeechModelId, TextToSpeechModelDescriptor>;

export const LOCAL_MODEL_REGISTRY = {
  ...SPEECH_TO_TEXT_MODELS,
  ...LANGUAGE_MODELS,
  ...TEXT_TO_SPEECH_MODELS,
} as const satisfies Record<LocalModelId, LocalModelDescriptor>;

export const LOCAL_MODELS = Object.freeze(
  Object.values(LOCAL_MODEL_REGISTRY),
) as readonly LocalModelDescriptor[];

export function isLocalModelId(value: string): value is LocalModelId {
  return Object.hasOwn(LOCAL_MODEL_REGISTRY, value);
}

export function getLocalModel(modelId: LocalModelId): LocalModelDescriptor {
  return LOCAL_MODEL_REGISTRY[modelId];
}

export function getLocalModelsByKind<K extends LocalModelKind>(
  kind: K,
): readonly Extract<LocalModelDescriptor, { kind: K }>[] {
  return LOCAL_MODELS.filter(
    (model): model is Extract<LocalModelDescriptor, { kind: K }> =>
      model.kind === kind,
  );
}
