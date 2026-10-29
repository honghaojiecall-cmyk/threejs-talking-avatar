import {
  clearStoredElevenLabsApiKey,
  getStoredElevenLabsApiKey,
  maskElevenLabsApiKey,
  SPEECH_RIG_TARGETS,
  SPEECH_DISCLOSURE,
  SpeechController,
  storeElevenLabsApiKey,
  type LocalLipSyncMode,
  type PerformanceAction,
  type PerformanceIntent,
  type PreparedSpeech,
  type ExpressivePerformanceFrame,
  type SpeechControllerSnapshot,
  type SpeechRigWeights,
} from '../speech';
import {
  BrowserLocalAgent,
  evaluateModelCompatibility,
  getLocalModel,
  type AgentEvent,
  type AgentMetric,
  type BrowserCapabilitySnapshot,
  type LanguageModelId,
  type LocalAgentModelRequest,
  type LocalAgentState,
  type LocalModelProgressEvent,
  type SpeechToTextModelId,
  type TextToSpeechModelId,
} from '../local-agent';
import type { PortraitLoadProgress } from './MintAvatar';
import { IpAvatar } from './IpAvatar';

const MAX_TEXT_LENGTH = 1000;
const DEFAULT_TTS_MODEL_ID: TextToSpeechModelId =
  'piper-zh-huayan-medium-wasm';

const PERFORMANCE_PREVIEW_INTENTS: Readonly<Record<string, PerformanceIntent>> = {
  neutral: {
    affect: 'neutral', intensity: 0.32, discourseAct: 'statement', confidence: 1,
    source: 'contextual-fallback',
  },
  warm: {
    affect: 'warm', intensity: 0.88, discourseAct: 'appreciation', confidence: 1,
    source: 'contextual-fallback',
  },
  surprise: {
    affect: 'surprise', intensity: 0.95, discourseAct: 'statement', confidence: 1,
    source: 'requested-emotion',
  },
  concerned: {
    affect: 'concerned', intensity: 0.9, discourseAct: 'warning', confidence: 1,
    source: 'contextual-fallback',
  },
  question: {
    affect: 'question', intensity: 0.85, discourseAct: 'question', confidence: 1,
    source: 'contextual-fallback',
  },
  emphatic: {
    affect: 'emphatic', intensity: 0.88, discourseAct: 'affirmation', confidence: 1,
    source: 'contextual-fallback',
  },
};

const SMILE_ACTION_PREVIEW: PerformanceAction = {
  gesture: 'smile',
  intensity: 0.85,
  onset: 'immediate',
  holdSeconds: 1.6,
  releaseSeconds: 0.7,
  valence: 0.8,
  arousal: 0.3,
  dominance: 0.1,
  source: 'llm-directive',
};

const NOD_ACTION_PREVIEW: PerformanceAction = {
  gesture: 'nod',
  intensity: 1,
  onset: 'immediate',
  holdSeconds: 0.9,
  releaseSeconds: 0.25,
  valence: 0.15,
  arousal: 0.55,
  dominance: 0.45,
  source: 'llm-directive',
};

const SHAKE_ACTION_PREVIEW: PerformanceAction = {
  gesture: 'shake',
  intensity: 1,
  onset: 'immediate',
  holdSeconds: 0.95,
  releaseSeconds: 0.25,
  valence: -0.25,
  arousal: 0.55,
  dominance: 0.35,
  source: 'llm-directive',
};

const WAVE_ACTION_PREVIEW: PerformanceAction = {
  gesture: 'wave',
  intensity: 1,
  onset: 'immediate',
  holdSeconds: 1.8,
  releaseSeconds: 0.6,
  valence: 0.7,
  arousal: 0.5,
  dominance: 0.2,
  source: 'llm-directive',
};

function makeActionPreview(
  gesture: PerformanceAction['gesture'],
  overrides: Partial<PerformanceAction> = {},
): PerformanceAction {
  return {
    gesture,
    intensity: 1,
    onset: 'immediate',
    holdSeconds: 1.2,
    releaseSeconds: 0.5,
    valence: 0,
    arousal: 0.5,
    dominance: 0,
    source: 'llm-directive',
    ...overrides,
  };
}

const ACTION_MENU: ReadonlyArray<{ gesture: string; label: string; action: PerformanceAction }> = [
  { gesture: 'smile', label: '微笑', action: SMILE_ACTION_PREVIEW },
  { gesture: 'nod', label: '点头', action: NOD_ACTION_PREVIEW },
  { gesture: 'shake', label: '摇头', action: SHAKE_ACTION_PREVIEW },
  { gesture: 'wave', label: '挥手', action: WAVE_ACTION_PREVIEW },
  { gesture: 'jump', label: '跳跃', action: makeActionPreview('jump', { arousal: 0.8, valence: 0.5, holdSeconds: 1.2, releaseSeconds: 0.4 }) },
  { gesture: 'surprise', label: '惊讶', action: makeActionPreview('surprise', { arousal: 0.9, valence: 0.3, holdSeconds: 1.4 }) },
  { gesture: 'curiosity', label: '好奇', action: makeActionPreview('curiosity', { valence: 0.3, holdSeconds: 1.6 }) },
  { gesture: 'emphasis', label: '强调', action: makeActionPreview('emphasis', { arousal: 0.7, dominance: 0.6, holdSeconds: 0.8, releaseSeconds: 0.3 }) },
  { gesture: 'concern', label: '关心', action: makeActionPreview('concern', { valence: -0.3, arousal: 0.35, holdSeconds: 1.5 }) },
  { gesture: 'glance_left', label: '左瞥', action: makeActionPreview('glance_left', { arousal: 0.3, holdSeconds: 0.9 }) },
  { gesture: 'glance_right', label: '右瞥', action: makeActionPreview('glance_right', { arousal: 0.3, holdSeconds: 0.9 }) },
  { gesture: 'reset', label: '复位', action: makeActionPreview('reset', { arousal: 0.2, holdSeconds: 0.2, releaseSeconds: 0.4 }) },
];

interface ArticulationSummary {
  label: string;
  value: number;
}

function previewWeights(name: string | undefined): SpeechRigWeights | undefined {
  if (!name) return undefined;
  const weights = Object.fromEntries(
    SPEECH_RIG_TARGETS.map((target) => [target, 0]),
  ) as SpeechRigWeights;
  if (name === 'idle') return weights;
  if (name === 'speaking') {
    weights.jawOpen = 0.36;
    weights.mouthE = 0.52;
    weights.tongueTipUp = 0.18;
    weights.contactAlveolar = 0.12;
    return weights;
  }
  if (name === 'bilabial-contact') {
    weights.lipsTogether = 1;
    weights.lipCompress = 0.76;
    weights.contactBilabial = 1;
    return weights;
  }
  if (name === 'labiodental-contact') {
    weights.jawOpen = 0.1;
    weights.lowerLipToTeeth = 1;
    weights.contactLabiodental = 1;
    return weights;
  }
  if (name === 'open-vowel') {
    weights.jawOpen = 0.68;
    weights.mouthAA = 0.72;
    weights.upperLipRaise = 0.16;
    weights.lowerLipDepress = 0.34;
    return weights;
  }
  if (name === 'rounded-vowel') {
    weights.mouthU = 0.86;
    weights.lipPucker = 0.7;
    weights.lipFunnel = 0.4;
    weights.lipRollOut = 0.18;
    return weights;
  }
  return undefined;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function formatModelSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function strongestArticulation(weights: Readonly<SpeechRigWeights>): ArticulationSummary {
  const gestures: ArticulationSummary[] = [
    { label: '双唇闭合 · /m b p/', value: Math.max(weights.lipsTogether, weights.contactBilabial) },
    { label: '下唇 → 牙齿 · /f v/', value: Math.max(weights.lowerLipToTeeth, weights.contactLabiodental) },
    { label: '舌在齿间 · /θ ð/', value: Math.max(weights.tongueBetweenTeeth, weights.contactDental) },
    { label: '舌尖 → 齿龈嵴 · /t d n/', value: Math.max(weights.tongueTipUp, weights.contactAlveolar) },
    { label: '舌侧接触 · /l/', value: Math.max(weights.tongueTipLateral, weights.contactLateral) },
    { label: '舌背抬起 · /k g ŋ/', value: Math.max(weights.tongueDorsumUp, weights.contactVelar) },
    { label: '咝音舌槽', value: Math.max(weights.tongueBladeGroove, weights.correctiveSibilantGroove) },
    { label: '圆唇', value: Math.max(weights.lipPucker, weights.lipFunnel) },
    { label: '开元音', value: Math.max(weights.mouthAA, weights.mouthE, weights.mouthO) },
    { label: '前元音 / 展唇', value: Math.max(weights.mouthI, weights.lipStretch) },
    { label: '下颌张开', value: weights.jawOpen },
  ];
  gestures.sort((a, b) => b.value - a.value);
  return gestures[0].value < 0.045 ? { label: '发音器官静止', value: 0 } : gestures[0];
}

export class PortraitApp {
  private readonly portrait: IpAvatar;
  private readonly speech: SpeechController;
  private readonly phraseInput = requireElement<HTMLTextAreaElement>('#phrase-input');
  private readonly count = requireElement<HTMLElement>('#character-count');
  private readonly speakButton = requireElement<HTMLButtonElement>('#speak-button');
  private readonly stopButton = requireElement<HTMLButtonElement>('#stop-button');
  private readonly replayButton = requireElement<HTMLButtonElement>('#replay-button');
  private readonly apiKeyManager =
    requireElement<HTMLElement>('#elevenlabs-key-manager');
  private readonly apiKeyForm =
    requireElement<HTMLFormElement>('#elevenlabs-key-form');
  private readonly apiKeyInput =
    requireElement<HTMLInputElement>('#elevenlabs-api-key');
  private readonly saveApiKeyButton =
    requireElement<HTMLButtonElement>('#save-elevenlabs-api-key');
  private readonly clearApiKeyButton =
    requireElement<HTMLButtonElement>('#clear-elevenlabs-api-key');
  private readonly apiKeyStatus =
    requireElement<HTMLElement>('#elevenlabs-api-key-status');
  private readonly apiKeyMask =
    requireElement<HTMLElement>('#elevenlabs-api-key-mask');
  private readonly status = requireElement<HTMLElement>('#speech-status');
  private readonly source = requireElement<HTMLElement>('#speech-source');
  private readonly phoneLabel = requireElement<HTMLElement>('.phoneme-label');
  private readonly phoneTrack = requireElement<HTMLElement>('#phoneme-track');
  private readonly gesture = requireElement<HTMLElement>('#active-gesture');
  private readonly loading = requireElement<HTMLElement>('#loading-overlay');
  private readonly loadingLabel = requireElement<HTMLElement>('#loading-label');
  private readonly loadingBar = requireElement<HTMLElement>('#loading-progress');
  private readonly evidenceDialog = requireElement<HTMLDialogElement>('#evidence-dialog');
  private readonly jawMeter = requireElement<HTMLElement>('#meter-jaw');
  private readonly lipMeter = requireElement<HTMLElement>('#meter-lips');
  private readonly tongueMeter = requireElement<HTMLElement>('#meter-tongue');
  private readonly talkButton = requireElement<HTMLButtonElement>('#talk-button');
  private readonly conversationStopButton =
    requireElement<HTMLButtonElement>('#conversation-stop-button');
  private readonly agentState = requireElement<HTMLElement>('#agent-state');
  private readonly voiceMonitor = requireElement<HTMLElement>('#voice-monitor');
  private readonly micStatus = requireElement<HTMLElement>('#mic-status');
  private readonly micDetail = requireElement<HTMLElement>('#mic-detail');
  private readonly micLevelMeter = requireElement<HTMLElement>('#mic-level-meter');
  private readonly micLevelValue = requireElement<HTMLElement>('#mic-level-value');
  private readonly listenStageDetail = requireElement<HTMLElement>('#listen-stage-detail');
  private readonly hearStageDetail = requireElement<HTMLElement>('#hear-stage-detail');
  private readonly thinkStageDetail = requireElement<HTMLElement>('#think-stage-detail');
  private readonly speakStageDetail = requireElement<HTMLElement>('#speak-stage-detail');
  private readonly latencyLlm = requireElement<HTMLElement>('#latency-llm');
  private readonly latencyClause = requireElement<HTMLElement>('#latency-clause');
  private readonly latencyTts = requireElement<HTMLElement>('#latency-tts');
  private readonly latencyAudio = requireElement<HTMLElement>('#latency-audio');
  private readonly voiceStages = Array.from(
    document.querySelectorAll<HTMLElement>('[data-voice-stage]'),
  );
  private readonly userTranscript = requireElement<HTMLElement>('#user-transcript');
  private readonly agentThinkingPanel =
    requireElement<HTMLDetailsElement>('#agent-thinking-panel');
  private readonly agentThinking = requireElement<HTMLElement>('#agent-thinking');
  private readonly agentReply = requireElement<HTMLElement>('#agent-reply');
  private readonly runtimeSummary = requireElement<HTMLElement>('#local-runtime-summary');
  private readonly webgpuDiagnostic = requireElement<HTMLElement>('#webgpu-diagnostic');
  private readonly cacheDiagnostic = requireElement<HTMLElement>('#cache-diagnostic');
  private readonly sttSelect = requireElement<HTMLSelectElement>('#stt-model-select');
  private readonly brainSelect = requireElement<HTMLSelectElement>('#brain-model-select');
  private readonly ttsSelect = requireElement<HTMLSelectElement>('#tts-model-select');
  private readonly lipSyncTimingSelect =
    requireElement<HTMLSelectElement>('#lip-sync-timing-select');
  private readonly warmRuntimeButton =
    requireElement<HTMLButtonElement>('#warm-runtime-button');
  private readonly reloadRuntimeButton =
    requireElement<HTMLButtonElement>('#reload-runtime-button');
  private readonly unloadRuntimeButton =
    requireElement<HTMLButtonElement>('#unload-runtime-button');
  private readonly runtimeActionStatus =
    requireElement<HTMLElement>('#runtime-action-status');
  private readonly sttRuntimeStatus =
    requireElement<HTMLOutputElement>('#stt-runtime-status');
  private readonly brainRuntimeStatus =
    requireElement<HTMLOutputElement>('#brain-runtime-status');
  private readonly ttsRuntimeStatus =
    requireElement<HTMLOutputElement>('#tts-runtime-status');
  private readonly timingRuntimeStatus =
    requireElement<HTMLOutputElement>('#timing-runtime-status');
  private readonly brainRuntimeLatency =
    requireElement<HTMLElement>('#brain-runtime-latency');
  private readonly ttsRuntimeLatency =
    requireElement<HTMLElement>('#tts-runtime-latency');
  private readonly timingRuntimeLatency =
    requireElement<HTMLElement>('#timing-runtime-latency');
  private readonly sttRuntimeLatency =
    requireElement<HTMLElement>('#stt-runtime-latency');
  private readonly sttModelDetailName =
    requireElement<HTMLElement>('#stt-model-detail-name');
  private readonly sttModelDetail = requireElement<HTMLElement>('#stt-model-detail');
  private readonly sttModelFootprint =
    requireElement<HTMLElement>('#stt-model-footprint');
  private readonly brainModelDetailName =
    requireElement<HTMLElement>('#brain-model-detail-name');
  private readonly brainModelDetail = requireElement<HTMLElement>('#brain-model-detail');
  private readonly brainModelFootprint =
    requireElement<HTMLElement>('#brain-model-footprint');
  private readonly ttsModelDetailName =
    requireElement<HTMLElement>('#tts-model-detail-name');
  private readonly ttsModelDetail = requireElement<HTMLElement>('#tts-model-detail');
  private readonly ttsModelFootprint = requireElement<HTMLElement>('#tts-model-footprint');
  private readonly timingModeDetailName =
    requireElement<HTMLElement>('#timing-mode-detail-name');
  private readonly timingModeDetail = requireElement<HTMLElement>('#timing-mode-detail');
  private readonly timingModeFootprint =
    requireElement<HTMLElement>('#timing-mode-footprint');
  private frame = 0;
  private animationFrame = 0;
  private startTime = performance.now();
  private lastTime = this.startTime;
  private smoothedFrameTimeMs = 16.67;
  private previewState: string | undefined;
  private expressiveFrame: Readonly<ExpressivePerformanceFrame> | undefined;
  private speechSnapshot: Readonly<SpeechControllerSnapshot>;
  private unsubscribeSpeech: (() => void) | undefined;
  private localAgent: BrowserLocalAgent | null = null;
  private localModelsReady = false;
  private readonly readyLocalModels = new Set<string>();
  private agentReplyDraft = '';
  private completedLocalRequests = 0;
  private localAgentState: LocalAgentState = 'idle';
  private micSessionActive = false;
  private micVoiceActive = false;
  private micRms = 0;
  private micSpeechProbability = 0;
  private renderedMicLevel = 0;
  private lastTtsSynthesisMs: number | undefined;
  private activeTimingTurnId = 0;
  private turnStartedAt: number | undefined;
  private brainStartedAt: number | undefined;
  private firstClauseAt: number | undefined;
  private firstAudioAt: number | undefined;
  private runtimeActionInFlight = false;
  private greetingAbort: AbortController | null = null;
  private disposed = false;
  private readonly onExpressionReviewKey = (event: KeyboardEvent): void => {
    if (!import.meta.env.DEV || !event.altKey || !event.shiftKey) return;
    const actionPreview = {
      Digit8: SMILE_ACTION_PREVIEW,
      Digit9: NOD_ACTION_PREVIEW,
      Digit0: SHAKE_ACTION_PREVIEW,
      Minus: WAVE_ACTION_PREVIEW,
    }[event.code];
    if (actionPreview) {
      event.preventDefault();
      this.triggerActionPreview(actionPreview);
      return;
    }
    const scenarios: Readonly<Record<string, string>> = {
      Digit1: 'neutral',
      Digit2: 'warm',
      Digit3: 'surprise',
      Digit4: 'concerned',
      Digit5: 'question',
      Digit6: 'emphatic',
      Digit7: 'warm-bilabial',
    };
    const scenario = scenarios[event.code];
    if (!scenario) return;
    event.preventDefault();
    this.setExpressionScenario(scenario);
  };

  private triggerActionPreview(actionPreview: PerformanceAction): void {
    this.speech.cancel();
    this.portrait.clearPreviewState();
    this.portrait.setPausedForScreenshot(false);
    this.speech.setConversationState('thinking');
    this.speech.performAction(actionPreview);
    document.body.dataset.testState = `action-${actionPreview.gesture}`;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.portrait = new IpAvatar(canvas, (progress) => this.onLoadProgress(progress));
    this.speech = new SpeechController();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.speech.setReducedMotion(reducedMotion);
    this.portrait.setReducedMotion(reducedMotion);
    this.speechSnapshot = this.speech.snapshot();
    this.unsubscribeSpeech = this.speech.subscribe((snapshot) => this.renderSpeechState(snapshot));
    this.ttsSelect.value = DEFAULT_TTS_MODEL_ID;
    document.querySelectorAll<HTMLButtonElement>('[data-action-gesture]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = ACTION_MENU.find((item) => item.gesture === button.dataset.actionGesture);
        if (entry) this.triggerActionPreview(entry.action);
      });
    });
    this.installEvents();
    if (import.meta.env.DEV) {
      window.addEventListener('keydown', this.onExpressionReviewKey);
    }
    this.localAgent = this.createLocalAgent();
    this.renderSelectedModels();
    void this.probeLocalCapabilities();
    this.installTestHooks();
    this.renderDisclosures();
    this.renderApiKeyState();
    this.updateCharacterCount();
  }

  start(): void {
    this.animationFrame = requestAnimationFrame((time) => this.loop(time));
    void this.portrait.load().then(
      () => {
        this.applyQueryVerificationState();
        document.body.dataset.model = 'ready';
        this.loadingLabel.textContent = '原生 GNM 绑定已就绪';
        this.loadingBar.style.setProperty('--progress', '1');
        window.setTimeout(() => this.loading.classList.add('is-hidden'), 180);
        window.setTimeout(() => {
          this.loading.hidden = true;
        }, 760);
      },
      (error: unknown) => {
        document.body.dataset.model = 'error';
        this.loadingLabel.textContent = 'GNM 头像加载失败。';
        this.status.textContent = error instanceof Error ? error.message : '模型加载失败。';
        this.status.dataset.state = 'error';
      },
    );
  }

  private applyQueryVerificationState(): void {
    const query = new URLSearchParams(window.location.search);
    const state = query.get('qaState');
    const view = query.get('qaView');
    const allowedStates = new Set([
      'idle',
      'speaking',
      'bilabial-contact',
      'labiodental-contact',
      'open-vowel',
      'rounded-vowel',
    ]);
    const allowedViews = new Set([
      'front',
      'three-quarter-left',
      'three-quarter-right',
      'profile-left',
      'profile-right',
    ]);
    if (state && allowedStates.has(state)) {
      this.portrait.setPreviewState(state);
      this.previewState = state;
      document.body.dataset.testState = state;
    }
    if (view && allowedViews.has(view)) {
      this.portrait.setInspectionView(view);
      document.body.dataset.testView = view;
    }
    if (state || view) {
      this.portrait.setPausedForScreenshot(true);
      this.portrait.setReducedMotion(true);
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('keydown', this.onExpressionReviewKey);
    this.unsubscribeSpeech?.();
    void this.localAgent?.dispose();
    void this.speech.close();
    this.portrait.dispose();
    window.__GNM_AVATAR_DIAGNOSTICS__ = undefined;
    window.__GNM_AVATAR_TEST_HOOKS__ = undefined;
  }

  private installEvents(): void {
    this.phraseInput.addEventListener('input', () => this.updateCharacterCount());
    this.phraseInput.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void this.speakPhrase();
      }
    });
    this.speakButton.addEventListener('click', () => void this.speakPhrase());
    this.apiKeyForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveElevenLabsApiKey();
    });
    this.apiKeyInput.addEventListener('input', () => {
      this.apiKeyInput.removeAttribute('aria-invalid');
      this.saveApiKeyButton.disabled = this.apiKeyInput.value.trim().length === 0;
    });
    this.clearApiKeyButton.addEventListener('click', () => this.clearElevenLabsApiKey());
    this.stopButton.addEventListener('click', () => this.speech.cancel());
    this.replayButton.addEventListener('click', () => void this.replay());
    this.talkButton.addEventListener('click', () => void this.startLocalConversation());
    this.conversationStopButton.addEventListener('click', () => {
      void this.stopLocalConversation();
    });
    for (const select of [this.sttSelect, this.brainSelect, this.ttsSelect]) {
      select.addEventListener('change', () => {
        this.renderSelectedModels();
        void this.switchSelectedRuntime();
      });
    }
    this.lipSyncTimingSelect.addEventListener('change', () => {
      const mode = this.selectedLipSyncMode();
      this.localAgent?.setLipSyncMode(mode);
      this.renderSelectedModelDetails();
      this.setRuntimeActionStatus('ready', `唇形同步策略已切换为${this.timingModeLabel(mode)}。`);
    });
    this.warmRuntimeButton.addEventListener('click', () => void this.warmLocalRuntime(false));
    this.reloadRuntimeButton.addEventListener('click', () => void this.warmLocalRuntime(true));
    this.unloadRuntimeButton.addEventListener('click', () => void this.unloadLocalRuntime());

    requireElement<HTMLButtonElement>('#open-evidence').addEventListener('click', () => {
      if (typeof this.evidenceDialog.showModal === 'function') this.evidenceDialog.showModal();
      else this.evidenceDialog.setAttribute('open', '');
    });
    requireElement<HTMLButtonElement>('#close-evidence').addEventListener('click', () => {
      this.evidenceDialog.close();
    });
    this.evidenceDialog.addEventListener('click', (event) => {
      if (event.target === this.evidenceDialog) this.evidenceDialog.close();
    });
  }

  private selectedModelRequest(): LocalAgentModelRequest {
    const stt = this.sttSelect.value as SpeechToTextModelId;
    const llm = this.brainSelect.value as LanguageModelId;
    const tts = this.ttsSelect.value as TextToSpeechModelId;
    return {
      stt,
      llm,
      tts,
      lipSyncMode: this.selectedLipSyncMode(),
      // Selecting the model and then pressing Talk is the explicit local-download action.
      consentedModelIds: [stt, llm, tts],
    };
  }

  private selectedLipSyncMode(): LocalLipSyncMode {
    return this.lipSyncTimingSelect.value as LocalLipSyncMode;
  }

  private createLocalAgent(): BrowserLocalAgent {
    return new BrowserLocalAgent(
      this.speech,
      {
        onAgentEvent: (event) => this.onLocalAgentEvent(event),
        onMetric: (metric) => this.onLocalAgentMetric(metric),
        onCapabilities: (capabilities) => this.renderLocalCapabilities(capabilities),
        onModelProgress: (progress) => this.renderLocalModelProgress(progress),
        onMicLevel: (rms, speechProbability) => {
          this.micRms = rms;
          this.micSpeechProbability = speechProbability;
        },
        onEchoSuppressed: () => {
          const stateAtNotice = this.localAgentState;
          this.agentState.textContent = '回声已抑制 · 仍在聆听';
          this.micDetail.textContent = '头像音频被拒绝 · 麦克风保持开启。';
          window.setTimeout(() => {
            if (this.localAgentState === stateAtNotice) {
              this.renderLocalAgentState(stateAtNotice);
            }
          }, 1_200);
        },
      },
      this.selectedModelRequest(),
    );
  }

  private async replaceLocalAgent(): Promise<void> {
    const previous = this.localAgent;
    this.localAgent = null;
    await previous?.dispose();
    if (this.disposed) return;
    this.localModelsReady = false;
    this.micSessionActive = false;
    this.micVoiceActive = false;
    this.micRms = 0;
    this.micSpeechProbability = 0;
    this.readyLocalModels.clear();
    this.completedLocalRequests = 0;
    this.localAgent = this.createLocalAgent();
    this.renderLocalAgentState('idle', '待加载');
    await this.probeLocalCapabilities();
  }

  private async switchSelectedRuntime(): Promise<void> {
    await this.runRuntimeAction(
      '正在卸载之前的大脑和声音…',
      async () => {
        await this.replaceLocalAgent();
      },
      '选择已就绪。现在预热,或准备好后按开始。',
      'idle',
    );
  }

  private async warmLocalRuntime(reload: boolean): Promise<void> {
    await this.runRuntimeAction(
      reload ? '正在释放显存,然后预热所选套件…' : '正在预热所选本地套件…',
      async () => {
        if (reload) await this.replaceLocalAgent();
        const localAgent = this.localAgent;
        if (!localAgent) throw new Error('本地运行时不可用。');
        this.setLaneRuntimeStatus(this.sttRuntimeStatus, '预热中', 'loading');
        this.setLaneRuntimeStatus(this.brainRuntimeStatus, '预热中', 'loading');
        this.setLaneRuntimeStatus(this.ttsRuntimeStatus, '预热中', 'loading');
        this.renderLocalAgentState('installing', '正在预热本地模型…');
        await localAgent.agent.initialize();
        if (localAgent.agent.snapshot().state === 'unsupported') {
          throw new Error('此浏览器不支持所选的本地套件。');
        }
        this.localModelsReady = true;
        this.setLaneRuntimeStatus(this.sttRuntimeStatus, '就绪', 'ready');
        this.setLaneRuntimeStatus(this.brainRuntimeStatus, '就绪', 'ready');
        this.setLaneRuntimeStatus(this.ttsRuntimeStatus, '就绪', 'ready');
        this.renderLocalAgentState('idle', '本地模型已就绪');
      },
      '大脑、声音和识别器已在本地内存中预热。',
      'ready',
    );
  }

  private async unloadLocalRuntime(): Promise<void> {
    await this.runRuntimeAction(
      '正在停止语音环路并释放本地模型内存…',
      async () => {
        this.speech.cancel();
        await this.replaceLocalAgent();
        this.renderSelectedModels();
      },
      '模型已卸载。缓存文件仍保留在本设备上。',
      'idle',
    );
  }

  private async runRuntimeAction(
    busyMessage: string,
    action: () => Promise<void>,
    successMessage: string,
    successState: 'idle' | 'ready',
  ): Promise<void> {
    if (this.runtimeActionInFlight || this.disposed) return;
    this.runtimeActionInFlight = true;
    this.setModelSelectorsDisabled(true);
    this.setRuntimeActionButtonsDisabled(true);
    this.setRuntimeActionStatus('busy', busyMessage);
    try {
      await action();
      this.setRuntimeActionStatus(successState, successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : '本地运行时操作失败。';
      this.setLaneRuntimeStatus(this.sttRuntimeStatus, '错误', 'error');
      this.setLaneRuntimeStatus(this.brainRuntimeStatus, '错误', 'error');
      this.setLaneRuntimeStatus(this.ttsRuntimeStatus, '错误', 'error');
      this.setRuntimeActionStatus('error', message);
      this.renderLocalAgentState('error', message);
    } finally {
      this.runtimeActionInFlight = false;
      const active = ['listening', 'transcribing', 'thinking', 'speaking', 'interrupted']
        .includes(this.localAgentState);
      this.setModelSelectorsDisabled(active);
      this.setRuntimeActionButtonsDisabled(
        active || this.localAgentState === 'installing' || this.localAgentState === 'unsupported',
      );
    }
  }

  private setRuntimeActionButtonsDisabled(disabled: boolean): void {
    this.warmRuntimeButton.disabled = disabled;
    this.reloadRuntimeButton.disabled = disabled;
    this.unloadRuntimeButton.disabled = disabled;
  }

  private setRuntimeActionStatus(
    state: 'idle' | 'busy' | 'ready' | 'error',
    message: string,
  ): void {
    this.runtimeActionStatus.dataset.state = state;
    this.runtimeActionStatus.textContent = message;
  }

  private setLaneRuntimeStatus(
    element: HTMLOutputElement,
    label: string,
    state: 'cold' | 'loading' | 'ready' | 'active' | 'error',
  ): void {
    element.value = label;
    element.textContent = label;
    element.dataset.state = state;
  }

  private async probeLocalCapabilities(): Promise<void> {
    try {
      await this.localAgent?.capabilities();
    } catch (error) {
      this.renderLocalAgentState(
        'unsupported',
        error instanceof Error ? error.message : '浏览器能力检测失败',
      );
    }
  }

  private async startLocalConversation(): Promise<void> {
    const localAgent = this.localAgent;
    if (!localAgent) return;
    this.portrait.clearPreviewState();
    this.previewState = undefined;
    this.speech.cancel();
    this.micSessionActive = false;
    this.micVoiceActive = false;
    this.setModelSelectorsDisabled(true);
    this.talkButton.disabled = true;
    this.renderLocalAgentState('installing', this.localModelsReady
      ? '正在打开麦克风…'
      : '正在准备本地模型…');
    try {
      await localAgent.agent.startListening();
      this.localModelsReady = true;
      this.micSessionActive = true;
      this.renderLocalAgentState('listening');
      this.playGreeting(localAgent);
    } catch (error) {
      this.micSessionActive = false;
      this.micVoiceActive = false;
      this.setModelSelectorsDisabled(false);
      this.talkButton.disabled = false;
      this.renderLocalAgentState(
        'error',
        error instanceof Error ? error.message : '本地语音设置失败',
      );
    }
  }

  private playGreeting(localAgent: BrowserLocalAgent): void {
    this.greetingAbort?.abort();
    const abort = new AbortController();
    this.greetingAbort = abort;
    const greeting =
      '你好呀!我是你的本地语音头像,所有模型都在这台设备上运行。准备好啦,直接开口跟我说话吧!';
    this.agentReply.textContent = greeting;
    this.speech.performAction({
      gesture: 'wave',
      intensity: 0.9,
      onset: 'immediate',
      holdSeconds: 1.8,
      releaseSeconds: 0.6,
      valence: 0.7,
      arousal: 0.5,
      dominance: 0.2,
      source: 'llm-directive',
    });
    void (async () => {
      try {
        if (!abort.signal.aborted) this.renderLocalAgentState('speaking');
        await localAgent.speakPhrase(greeting, abort.signal);
      } catch {
        // The greeting is best-effort; the conversation loop stays live.
      } finally {
        if (this.greetingAbort === abort) this.greetingAbort = null;
        if (
          !abort.signal.aborted &&
          this.micSessionActive &&
          this.localAgentState === 'speaking'
        ) {
          this.renderLocalAgentState('listening');
        }
      }
    })();
  }

  private async stopLocalConversation(): Promise<void> {
    this.greetingAbort?.abort();
    this.greetingAbort = null;
    this.micSessionActive = false;
    this.micVoiceActive = false;
    this.micRms = 0;
    this.micSpeechProbability = 0;
    await this.localAgent?.agent.stopListening().catch(() => undefined);
    this.speech.cancel();
    this.setModelSelectorsDisabled(false);
    this.renderLocalAgentState('idle', this.localModelsReady
      ? '本地模型已就绪'
      : '待加载');
  }

  private async pauseLocalAgentForDirectSpeech(): Promise<void> {
    const state = this.localAgent?.agent.snapshot().state;
    if (state && !['idle', 'unsupported', 'error'].includes(state)) {
      await this.stopLocalConversation();
    }
  }

  private setModelSelectorsDisabled(disabled: boolean): void {
    this.sttSelect.disabled = disabled;
    this.brainSelect.disabled = disabled;
    this.ttsSelect.disabled = disabled;
    this.lipSyncTimingSelect.disabled = disabled;
  }

  private onLocalAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'state':
        if (event.to !== 'listening' && event.to !== 'interrupted') {
          this.micVoiceActive = false;
        }
        this.renderLocalAgentState(event.to);
        break;
      case 'turn-started':
        this.resetPipelineTiming(event.turnId);
        this.micVoiceActive = false;
        this.lastTtsSynthesisMs = undefined;
        this.renderVoiceMonitor();
        this.agentReplyDraft = '';
        this.agentThinkingPanel.hidden = false;
        this.agentThinkingPanel.open = true;
        this.agentThinking.textContent = '正在本地思考…';
        this.userTranscript.textContent = '正在本地转写…';
        this.agentReply.textContent = '正在本设备上思考…';
        break;
      case 'transcript':
        this.micVoiceActive = false;
        this.userTranscript.textContent = event.text;
        break;
      case 'speech-start':
        this.greetingAbort?.abort();
        this.greetingAbort = null;
        this.micVoiceActive = true;
        this.renderLocalAgentState('listening');
        break;
      case 'reasoning':
        this.agentThinkingPanel.hidden = false;
        this.agentThinkingPanel.open = true;
        this.agentThinking.textContent = event.text;
        break;
      case 'performance-action':
        this.speech.performAction(event.action);
        break;
      case 'clause':
        this.agentReplyDraft = this.agentReplyDraft
          ? `${this.agentReplyDraft} ${event.text}`
          : event.text;
        this.agentReply.textContent = this.agentReplyDraft;
        break;
      case 'assistant-spoken':
        this.agentReply.textContent = event.text || this.agentReplyDraft;
        break;
      case 'barge-in':
        this.agentState.textContent = '已打断 · 正在听你说话';
        break;
      case 'error':
        this.renderLocalAgentState('error', event.error.message);
        break;
      default:
        break;
    }
  }

  private onLocalAgentMetric(metric: AgentMetric): void {
    if (metric.type === 'turn' && metric.status === 'started') {
      if (metric.turnId !== this.activeTimingTurnId) this.resetPipelineTiming(metric.turnId);
      this.turnStartedAt = metric.at;
      return;
    }
    if (metric.type === 'clause' && this.firstClauseAt === undefined) {
      this.firstClauseAt = metric.at;
      this.renderLatency(
        this.latencyClause,
        metric.at - (this.brainStartedAt ?? this.turnStartedAt ?? metric.at),
      );
      return;
    }
    if (metric.type === 'milestone') {
      if (metric.stage === 'llm-first-token') {
        const duration = metric.durationMs ?? metric.at - (this.brainStartedAt ?? metric.at);
        this.renderLatency(
          this.latencyLlm,
          duration,
        );
        this.renderRuntimeLatency(this.brainRuntimeLatency, '首个 TOKEN', duration);
      } else if (metric.stage === 'audio-start' && this.firstAudioAt === undefined) {
        this.firstAudioAt = metric.at;
        const duration = metric.at - (this.turnStartedAt ?? metric.at);
        this.renderLatency(
          this.latencyAudio,
          duration,
        );
        this.renderRuntimeLatency(this.timingRuntimeLatency, '出声', duration);
        this.renderVoiceMonitor();
      }
      return;
    }
    if (metric.type !== 'request') return;
    if (metric.phase === 'brain' && metric.status === 'started' && this.brainStartedAt === undefined) {
      this.brainStartedAt = metric.at;
    }
    if (metric.status !== 'completed') return;
    this.completedLocalRequests += 1;
    document.body.dataset.localRequestCount = String(this.completedLocalRequests);
    document.body.dataset.localPhase = metric.phase;
    if (metric.durationMs !== undefined) {
      document.body.dataset.localPhaseMs = metric.durationMs.toFixed(1);
      if (metric.phase === 'stt') {
        this.renderRuntimeLatency(this.sttRuntimeLatency, '识别', metric.durationMs);
      } else if (metric.phase === 'tts') {
        if (this.lastTtsSynthesisMs === undefined) {
          this.lastTtsSynthesisMs = metric.durationMs;
          this.renderLatency(this.latencyTts, metric.durationMs);
          this.renderRuntimeLatency(this.ttsRuntimeLatency, '合成', metric.durationMs);
        }
        document.body.dataset.ttsSynthesisMs = metric.durationMs.toFixed(1);
      }
    }
  }

  private renderLocalAgentState(state: LocalAgentState, detail?: string): void {
    const labels: Record<LocalAgentState, string> = {
      unsupported: '语音模式不可用',
      installing: '正在设置',
      idle: this.localModelsReady ? '麦克风已暂停' : '待加载',
      listening: this.micVoiceActive ? '正在听你说话' : '聆听中',
      transcribing: '转写中',
      thinking: '正在组织回复',
      speaking: '回复中',
      interrupted: '重新聆听',
      error: '语音出错',
    };
    this.localAgentState = state;
    this.speech.setConversationState(state);
    this.agentState.textContent = detail ?? labels[state];
    this.agentState.dataset.state = state;
    document.body.dataset.agentState = state;
    const active = ['listening', 'transcribing', 'thinking', 'speaking', 'interrupted'].includes(state);
    this.conversationStopButton.disabled = !active;
    this.talkButton.disabled = active || state === 'installing' || state === 'unsupported';
    this.setRuntimeActionButtonsDisabled(
      active || state === 'installing' || state === 'unsupported' || this.runtimeActionInFlight,
    );
    const stopLabel = this.conversationStopButton.querySelector('span');
    if (stopLabel) stopLabel.textContent = active ? '停止会话' : '麦克风已停止';
    this.conversationStopButton.setAttribute(
      'aria-label',
      active ? '停止麦克风和当前回复' : '麦克风已停止',
    );
    const label = this.talkButton.querySelector('span');
    if (label) {
      const activeLabels: Partial<Record<LocalAgentState, string>> = {
        listening: this.micVoiceActive ? '正在听你说话' : '聆听中',
        transcribing: '正在本地转写…',
        thinking: '正在准备回复…',
        speaking: '正在回复…',
        interrupted: '聆听中',
      };
      label.textContent = state === 'unsupported'
        ? '本地对话需要 WebGPU'
        : state === 'installing'
          ? '正在准备本地模型…'
          : activeLabels[state] ?? (this.localModelsReady
            ? '开始聆听'
            : `加载 ${this.selectedDownloadLabel()} 并开始演示`);
    }
    this.renderVoiceMonitor();
  }

  private renderVoiceMonitor(): void {
    const state = this.localAgentState;
    const phase = state === 'installing'
      ? 'setup'
      : state === 'listening' || state === 'interrupted'
        ? 'listen'
        : state === 'transcribing'
          ? 'hear'
        : state === 'thinking'
          ? 'think'
          : state === 'speaking'
            ? 'speak'
            : state === 'error' || state === 'unsupported'
              ? 'error'
              : 'off';
    const micMode = state === 'installing'
      ? 'arming'
      : !this.micSessionActive
        ? 'off'
        : this.micVoiceActive
          ? 'voice'
          : 'live';

    this.voiceMonitor.dataset.phase = phase;
    this.voiceMonitor.dataset.mic = micMode;
    document.body.dataset.micState = micMode;

    const copy: Record<LocalAgentState, { status: string; detail: string }> = {
      unsupported: {
        status: '麦克风不可用',
        detail: '此浏览器无法运行完整的本地语音环路。',
      },
      installing: {
        status: this.localModelsReady ? '正在打开麦克风' : '正在准备',
        detail: this.localModelsReady
          ? '等待浏览器授权 · 输入尚未开启。'
          : '模型正在本地加载,麦克风尚未打开。',
      },
      idle: {
        status: '麦克风已暂停',
        detail: '输入已关闭。准备好后即可开始聆听。',
      },
      listening: this.micVoiceActive
        ? {
            status: '检测到语音',
            detail: `${getLocalModel(this.sttSelect.value as SpeechToTextModelId).displayName} 正在本地采集你的声音。`,
          }
        : {
            status: '麦克风聆听中',
            detail: `${getLocalModel(this.sttSelect.value as SpeechToTextModelId).displayName} 正在本地聆听,随时开口即可。`,
          },
      transcribing: {
        status: '语音已捕获',
        detail: '正在本地解码你的语音 · 麦克风保持开启。',
      },
      thinking: {
        status: '正在生成回复',
        detail: `${getLocalModel(this.brainSelect.value as LanguageModelId).displayName} 正在思考 · 麦克风保持开启。`,
      },
      speaking: {
        status: '头像回复中',
        detail: `${this.lastTtsSynthesisMs === undefined
          ? `${getLocalModel(this.ttsSelect.value as TextToSpeechModelId).displayName} 正在准备`
          : `声音在 ${(this.lastTtsSynthesisMs / 1_000).toFixed(1)} 秒内就绪`} · 开口即可打断。`,
      },
      interrupted: {
        status: '已听到打断',
        detail: '上一段回复已停止,请继续说。',
      },
      error: {
        status: '麦克风出错',
        detail: '语音会话已停止。请查看上方信息后重试。',
      },
    };
    this.micStatus.textContent = copy[state].status;
    this.micDetail.textContent = copy[state].detail;

    const stageIndex = phase === 'listen'
      ? 0
      : phase === 'hear'
        ? 1
        : phase === 'think'
          ? 2
          : phase === 'speak'
            ? 3
            : -1;
    for (const [index, stage] of this.voiceStages.entries()) {
      stage.classList.toggle('is-active', index === stageIndex);
      stage.classList.toggle('is-complete', stageIndex > index);
      if (index === stageIndex) stage.setAttribute('aria-current', 'step');
      else stage.removeAttribute('aria-current');
    }

    this.listenStageDetail.textContent = getLocalModel(
      this.sttSelect.value as SpeechToTextModelId,
    ).displayName;
    this.hearStageDetail.textContent = state === 'listening'
      ? this.micVoiceActive ? '采集中' : '等待中'
      : state === 'transcribing'
        ? '解码中'
        : ['thinking', 'speaking'].includes(state)
          ? '已捕获'
          : state === 'interrupted'
            ? '已重新打开'
            : '麦克风关闭';
    this.thinkStageDetail.textContent = state === 'thinking'
      ? '生成中'
      : state === 'speaking'
        ? '已完成'
        : '等待中';
    this.speakStageDetail.textContent = state === 'speaking'
      ? this.firstAudioAt === undefined ? '合成中' : '音频 + 面部'
      : '等待中';
  }

  private updateMicMonitor(delta: number): void {
    const logarithmicLevel = Math.max(
      0,
      Math.min(1, (Math.log10(Math.max(0.00001, this.micRms)) + 3) / 2),
    );
    const speechLift = this.micSpeechProbability > 0.5
      ? (this.micSpeechProbability - 0.5) * 1.45
      : 0;
    const target = this.micSessionActive
      ? Math.max(logarithmicLevel, Math.min(0.92, speechLift))
      : 0;
    const response = target > this.renderedMicLevel ? 22 : 7;
    const blend = 1 - Math.exp(-Math.max(0, delta) * response);
    this.renderedMicLevel += (target - this.renderedMicLevel) * blend;
    const level = Math.max(0, Math.min(1, this.renderedMicLevel));
    this.voiceMonitor.style.setProperty('--mic-level', level.toFixed(3));
    this.voiceMonitor.dataset.signal = this.micSessionActive && (
      this.micVoiceActive || this.micSpeechProbability >= 0.82
    ) ? 'voice' : 'ambient';

    if (this.frame % 6 === 0) {
      const percentage = Math.round(level * 100);
      this.micLevelValue.textContent = String(percentage).padStart(2, '0');
      this.micLevelMeter.setAttribute('aria-valuenow', String(percentage));
    }
  }

  private renderLocalCapabilities(capabilities: BrowserCapabilitySnapshot): void {
    const selectedModels = [
      getLocalModel(this.sttSelect.value as SpeechToTextModelId),
      getLocalModel(this.brainSelect.value as LanguageModelId),
      getLocalModel(this.ttsSelect.value as TextToSpeechModelId),
    ];
    const selectedPathReady = selectedModels.every(
      (model) => evaluateModelCompatibility(model, capabilities).supported,
    );
    this.webgpuDiagnostic.textContent = capabilities.webgpu.adapterAvailable
      ? capabilities.webgpu.shaderF16
        ? '就绪 · shader-f16'
        : '就绪 · 仅 fp32'
      : '不可用';
    this.cacheDiagnostic.textContent = capabilities.storage.cacheStorage
      ? capabilities.storage.persisted
        ? '持久化'
        : 'Cache API 就绪'
      : capabilities.storage.opfs
        ? 'OPFS 就绪'
        : '不可用';
    this.runtimeSummary.textContent = selectedPathReady
      ? '所选本地路径已就绪'
      : '所选路径不可用';
    if (!selectedPathReady) this.renderLocalAgentState('unsupported');
    else if (this.agentState.dataset.state === 'idle') this.renderLocalAgentState('idle');
  }

  private renderLocalModelProgress(progress: LocalModelProgressEvent): void {
    const row = document.querySelector<HTMLElement>(
      `.model-progress[data-model-id="${progress.modelId}"]`,
    );
    if (!row) return;
    const fraction = progress.fraction ?? 0;
    const laneState = fraction >= 1 ? 'ready' : 'loading';
    const laneLabel = fraction >= 1
      ? '就绪'
      : progress.fraction === null
        ? '预热中'
        : `${Math.round(fraction * 100)}%`;
    if (progress.modelId === this.sttSelect.value) {
      this.setLaneRuntimeStatus(this.sttRuntimeStatus, laneLabel, laneState);
    } else if (progress.modelId === this.brainSelect.value) {
      this.setLaneRuntimeStatus(this.brainRuntimeStatus, laneLabel, laneState);
    } else if (progress.modelId === this.ttsSelect.value) {
      this.setLaneRuntimeStatus(this.ttsRuntimeStatus, laneLabel, laneState);
    }
    row.style.setProperty('--progress', fraction.toFixed(3));
    row.dataset.ready = String(fraction >= 1);
    if (fraction >= 1) {
      this.readyLocalModels.add(progress.modelId);
      this.localModelsReady = this.readyLocalModels.size >= 3;
    }
    const state = row.querySelector<HTMLElement>('em');
    if (state) {
      state.textContent = fraction >= 1
        ? '就绪 · 本地'
        : progress.fraction === null
          ? '准备中…'
          : `${Math.round(fraction * 100)}%`;
      state.title = progress.message;
    }
  }

  private renderSelectedModels(): void {
    const selections = [
      { kind: '聆听', id: this.sttSelect.value as SpeechToTextModelId },
      { kind: '思考', id: this.brainSelect.value as LanguageModelId },
      { kind: '说话', id: this.ttsSelect.value as TextToSpeechModelId },
    ] as const;
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.model-progress'));
    for (const [index, selection] of selections.entries()) {
      const row = rows[index];
      if (!row) continue;
      const model = getLocalModel(selection.id);
      row.dataset.modelId = model.id;
      row.dataset.ready = 'false';
      row.style.setProperty('--progress', '0');
      const label = row.querySelector<HTMLElement>('span');
      const state = row.querySelector<HTMLElement>('em');
      if (label) {
        label.replaceChildren();
        const kind = document.createElement('b');
        kind.textContent = selection.kind;
        label.append(kind, document.createTextNode(model.displayName));
      }
      if (state) state.textContent = formatModelSize(model.artifact.estimatedDownloadBytes);
    }
    this.readyLocalModels.clear();
    this.localModelsReady = false;
    this.setLaneRuntimeStatus(this.sttRuntimeStatus, '未加载', 'cold');
    this.setLaneRuntimeStatus(this.brainRuntimeStatus, '未加载', 'cold');
    this.setLaneRuntimeStatus(this.ttsRuntimeStatus, '未加载', 'cold');
    this.renderRuntimeLatency(this.brainRuntimeLatency, '首个 TOKEN');
    this.renderRuntimeLatency(this.ttsRuntimeLatency, '合成');
    this.renderRuntimeLatency(this.timingRuntimeLatency, '出声');
    this.renderRuntimeLatency(this.sttRuntimeLatency, '识别');
    this.renderSelectedModelDetails();
    if (!this.runtimeActionInFlight) {
      this.setRuntimeActionStatus('idle', '模型仅在你要求时加载。');
    }
    this.renderLocalAgentState('idle');
  }

  private renderSelectedModelDetails(): void {
    const stt = getLocalModel(this.sttSelect.value as SpeechToTextModelId);
    const brain = getLocalModel(this.brainSelect.value as LanguageModelId);
    const tts = getLocalModel(this.ttsSelect.value as TextToSpeechModelId);
    if (tts.kind !== 'tts') throw new Error('Selected voice descriptor is not a TTS model.');
    const memoryNotes: Readonly<Record<string, string>> = {
      'kimi-k3-256k-api': '云端 API · 不占本地 GPU 显存',
      'qwen3-asr-0.6b-api': '服务端 API · 不占本地资源',
      'whisper-small-multilingual-q8': 'CPU/WASM · 中文及多语言识别',
      'whisper-tiny-multilingual-q8': 'CPU/WASM · 中文及多语言识别',
      'piper-zh-huayan-medium-wasm': 'CPU/WASM · 中文普通话语音',
      'moonshine-tiny-q8': 'CPU/WASM · 低延迟英文',
      'whisper-tiny-en-q8': 'CPU/WASM · 广泛兼容',
      'qwen2.5-0.5b-instruct-q4f16': 'WebLLM 约 0.95 GB 显存',
      'qwen3.5-0.8b-q4f16': 'WebLLM 约 1.63 GB 显存',
      'qwen3.5-2b-q4f16': 'WebLLM 约 2.25 GB 显存',
      'qwen3.5-4b-q4f16': 'WebLLM 约 3.87 GB 显存',
      'gemma-4-e2b-it-litert-web': 'WebGPU 工作显存因设备而异',
      'gemma-4-e4b-it-litert-web': 'WebGPU 显存占用高,因设备而异',
      'gemma-3-1b-it-q4f16': '适配器待接入',
      'supertonic-2-instant-webgpu': 'WebGPU · WASM 回退 · 2 步',
      'supertonic-2-quality-webgpu': 'WebGPU · WASM 回退 · 5 步',
      'kitten-tts-nano-0.8-fp32-webgpu': 'WebGPU · WASM 回退 · 15M 参数',
      'kokoro-82m-timestamped-q8-wasm': 'CPU/WASM · 合成原生时间戳',
      'kokoro-82m-timestamped-fp32-webgpu': 'WebGPU · 合成原生时间戳',
      'kokoro-82m-q8-wasm': 'CPU/WASM · 音素原生',
      'kokoro-82m-fp32-webgpu': 'WebGPU · 音素原生',
    };
    this.sttModelDetailName.textContent = stt.displayName;
    this.sttModelDetail.textContent = stt.description;
    this.sttModelFootprint.textContent =
      `下载 ${formatModelSize(stt.artifact.estimatedDownloadBytes)} · ${memoryNotes[stt.id] ?? '本地语音识别'}`;
    this.brainModelDetailName.textContent = brain.displayName;
    this.brainModelDetail.textContent = brain.description;
    this.brainModelFootprint.textContent =
      `下载 ${formatModelSize(brain.artifact.estimatedDownloadBytes)} · ${memoryNotes[brain.id] ?? '需在本设备实测'}`;
    this.ttsModelDetailName.textContent = tts.displayName;
    this.ttsModelDetail.textContent = tts.description;
    this.ttsModelFootprint.textContent =
      `下载 ${formatModelSize(tts.artifact.estimatedDownloadBytes)} · ${memoryNotes[tts.id] ?? '需在本设备实测'}`;

    const mode = this.selectedLipSyncMode();
    const timingCopy: Readonly<Record<LocalLipSyncMode, {
      name: string;
      detail: string;
      footprint: string;
      badge: string;
    }>> = {
      auto: {
        name: '自动仲裁',
        detail: '优先使用合成原生时间戳,再应用最安全的本地回退。',
        footprint: '无需额外模型 · 推荐混合语音引擎使用',
        badge: '自动',
      },
      native: {
        name: '原生音素窗口',
        detail: '保留合成原生音素边界,不做声学重定时。',
        footprint: '最适合搭配带时间戳的 Kokoro 引擎',
        badge: '原生',
      },
      waveform: {
        name: '波形精修',
        detail: '用本地能量、浊音与瞬态线索精修 IPA 窗口。',
        footprint: '确定性浏览器 DSP · 无需下载模型',
        badge: '波形',
      },
      heuristic: {
        name: '音素时长',
        detail: '使用确定性 G2P 时长窗口,不做声学边界微调。',
        footprint: '适用于所有本地声音的通用回退',
        badge: '启发式',
      },
    };
    const timing = timingCopy[mode];
    this.timingModeDetailName.textContent = timing.name;
    this.timingModeDetail.textContent = mode === 'native' && !tts.producesNativeVisemeTiming
      ? `${tts.displayName} 没有原生时间戳,将保留其提供的音素估计。`
      : timing.detail;
    this.timingModeFootprint.textContent = timing.footprint;
    this.setLaneRuntimeStatus(this.timingRuntimeStatus, timing.badge, 'active');
  }

  private timingModeLabel(mode: LocalLipSyncMode): string {
    const labels: Readonly<Record<LocalLipSyncMode, string>> = {
      auto: '自动',
      native: '原生时序',
      waveform: '波形精修',
      heuristic: '音素时长',
    };
    return labels[mode];
  }

  private resetPipelineTiming(turnId: number): void {
    this.activeTimingTurnId = turnId;
    this.turnStartedAt = undefined;
    this.brainStartedAt = undefined;
    this.firstClauseAt = undefined;
    this.firstAudioAt = undefined;
    for (const element of [
      this.latencyLlm,
      this.latencyClause,
      this.latencyTts,
      this.latencyAudio,
    ]) {
      element.textContent = '—';
      element.dataset.ready = 'false';
      element.removeAttribute('title');
    }
    this.renderRuntimeLatency(this.brainRuntimeLatency, '首个 TOKEN');
    this.renderRuntimeLatency(this.ttsRuntimeLatency, '合成');
    this.renderRuntimeLatency(this.timingRuntimeLatency, '出声');
    this.renderRuntimeLatency(this.sttRuntimeLatency, '识别');
  }

  private renderLatency(element: HTMLElement, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    element.textContent = durationMs < 1_000
      ? `${Math.round(durationMs)} ms`
      : `${(durationMs / 1_000).toFixed(2)} s`;
    element.dataset.ready = 'true';
    element.title = `${durationMs.toFixed(1)} 毫秒`;
  }

  private renderRuntimeLatency(
    element: HTMLElement,
    label: string,
    durationMs?: number,
  ): void {
    if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
      element.textContent = `${label} —`;
      element.dataset.ready = 'false';
      element.removeAttribute('title');
      return;
    }
    const value = durationMs < 1_000
      ? `${Math.round(durationMs)} 毫秒`
      : `${(durationMs / 1_000).toFixed(2)} 秒`;
    element.textContent = `${label} ${value}`;
    element.dataset.ready = 'true';
    element.title = `${durationMs.toFixed(1)} 毫秒`;
  }

  private selectedDownloadLabel(): string {
    const request = this.selectedModelRequest();
    const ids = [request.stt, request.llm, request.tts].filter(
      (id): id is SpeechToTextModelId | LanguageModelId | TextToSpeechModelId => id !== undefined,
    );
    const total = ids.reduce(
      (sum, id) => sum + getLocalModel(id).artifact.estimatedDownloadBytes,
      0,
    );
    return formatModelSize(total);
  }

  private installTestHooks(): void {
    window.__GNM_AVATAR_TEST_HOOKS__ = {
      seed: (value: number) => {
        // Blink timing is deterministic; the seed shifts its phase reproducibly.
        this.startTime = performance.now() - Math.abs(value % 5000);
      },
      setState: (name: string) => {
        this.speech.cancel();
        this.portrait.setPreviewState(name);
        this.previewState = name;
        document.body.dataset.testState = name;
      },
      setExpressionScenario: (name: string) => {
        this.setExpressionScenario(name);
      },
      setView: (name: string) => {
        this.portrait.setInspectionView(name);
        document.body.dataset.testView = name;
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.portrait.setPausedForScreenshot(paused);
      },
      setReducedMotion: (enabled: boolean) => {
        this.portrait.setReducedMotion(enabled);
        this.speech.setReducedMotion(enabled);
        document.body.classList.toggle('reduced-motion', enabled);
      },
      hideDebugUi: (hidden: boolean) => {
        document.body.classList.toggle('hide-diagnostics', hidden);
      },
      captureCanvasPng: () => this.portrait.captureCanvasPng(),
    };
  }

  private setExpressionScenario(name: string): void {
    const affectName = name === 'warm-bilabial' ? 'warm' : name;
    const intent = PERFORMANCE_PREVIEW_INTENTS[affectName];
    if (!intent) throw new Error(`Unknown expression scenario: ${name}`);
    this.portrait.clearPreviewState();
    this.previewState = undefined;
    this.speech.setDeterministicPerformancePreview(intent);
    if (name === 'warm-bilabial') {
      this.portrait.setPreviewState('bilabial-contact');
      this.previewState = 'bilabial-contact';
    }
    this.portrait.setPausedForScreenshot(true);
    document.body.dataset.testState = `expression-${name}`;
  }

  private async speakPhrase(): Promise<void> {
    if (!getStoredElevenLabsApiKey()) {
      this.status.textContent = '请先添加你的 ElevenLabs API 密钥,再生成自定义短语。';
      this.status.dataset.state = 'error';
      this.apiKeyStatus.textContent = '需要 API 密钥';
      this.apiKeyInput.focus();
      return;
    }
    await this.pauseLocalAgentForDirectSpeech();
    const text = this.phraseInput.value.trim();
    if (!text) {
      this.status.textContent = '请先输入一段短语。';
      this.status.dataset.state = 'error';
      this.phraseInput.focus();
      return;
    }
    this.portrait.clearPreviewState();
    this.previewState = undefined;
    try {
      const prepared = await this.speech.speak(text);
      this.renderPhonemes(prepared);
    } catch {
      // The controller subscription presents the sanitized error.
    }
  }

  private async replay(): Promise<void> {
    await this.pauseLocalAgentForDirectSpeech();
    this.portrait.clearPreviewState();
    this.previewState = undefined;
    try {
      await this.speech.replay();
    } catch {
      // The controller exposes this through the live status region.
    }
  }

  private loop(now: number): void {
    if (this.disposed) return;
    const delta = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    const elapsed = (now - this.startTime) / 1000;
    this.lastTime = now;
    this.frame += 1;
    if (delta > 0) {
      const frameTimeMs = delta * 1000;
      this.smoothedFrameTimeMs += (frameTimeMs - this.smoothedFrameTimeMs) * 0.08;
    }

    const speechWeights = this.speech.update();
    this.expressiveFrame = this.speech.updatePerformance();
    const weights = previewWeights(this.previewState) ?? speechWeights;
    this.portrait.setSpeechWeights(speechWeights);
    this.portrait.setExpressivePerformance(this.expressiveFrame);
    this.portrait.update(delta, elapsed);
    this.portrait.render();
    this.updateArticulationUi(weights);
    this.updateMicMonitor(delta);
    this.publishDiagnostics(elapsed);

    this.animationFrame = requestAnimationFrame((time) => this.loop(time));
  }

  private renderSpeechState(snapshot: Readonly<SpeechControllerSnapshot>): void {
    this.speechSnapshot = snapshot;
    const busy = snapshot.state === 'loading' || snapshot.state === 'playing';
    const hasApiKey = Boolean(getStoredElevenLabsApiKey());
    this.speakButton.disabled = snapshot.state === 'loading' || !hasApiKey;
    this.stopButton.disabled = !busy;
    this.replayButton.disabled = !snapshot.prepared || busy;
    this.source.textContent = snapshot.prepared
      ? snapshot.prepared.source === 'live-synthesis'
        ? '实时合成语音'
        : `${snapshot.prepared.voice.displayName} · PCM + IPA`
      : '未加载音频';

    const labels: Record<SpeechControllerSnapshot['state'], string> = {
      idle: hasApiKey ? '可以生成短语了' : '添加 API 密钥后生成短语',
      loading: '正在生成音频与带时间戳的发音动作…',
      ready: '语音已就绪',
      playing: '播放中 · 已锁定 Web Audio 时钟',
      ended: '播放完成',
      error: snapshot.error?.message ?? '语音生成失败。',
    };
    this.status.textContent = labels[snapshot.state];
    this.status.dataset.state = snapshot.state;
    document.body.dataset.speech = snapshot.state;
    if (snapshot.prepared && this.phoneTrack.childElementCount === 0) {
      this.renderPhonemes(snapshot.prepared);
    }
  }

  private renderPhonemes(prepared: PreparedSpeech): void {
    this.phoneTrack.replaceChildren();
    this.phoneLabel.textContent = prepared.phonemes.some(
      (phone) => phone.source === 'waveform-refined',
    )
      ? 'IPA / 波形精修音素窗口'
      : 'IPA / 提供方估计音素窗口';
    const visiblePhones = prepared.phonemes.filter((phone) => phone.normalizedPhone !== 'sil');
    for (const interval of visiblePhones.slice(0, 140)) {
      const chip = document.createElement('span');
      chip.className = 'phone-chip';
      chip.textContent = interval.normalizedPhone || interval.phone;
      chip.title = `${interval.startTime.toFixed(3)}–${interval.endTime.toFixed(3)} 秒 · ${interval.source}`;
      this.phoneTrack.append(chip);
    }
    if (visiblePhones.length > 140) {
      const remainder = document.createElement('span');
      remainder.className = 'phone-chip phone-chip--more';
      remainder.textContent = `+${visiblePhones.length - 140}`;
      this.phoneTrack.append(remainder);
    }
  }

  private updateArticulationUi(weights: Readonly<SpeechRigWeights>): void {
    const summary = strongestArticulation(weights);
    this.gesture.textContent = summary.label;
    this.gesture.style.setProperty('--activity', summary.value.toFixed(3));
    const lipValue = Math.max(
      weights.lipsTogether,
      weights.contactBilabial,
      weights.lowerLipToTeeth,
      weights.contactLabiodental,
      weights.lipCompress,
      weights.lipRollIn,
      weights.lipRollOut,
      weights.lipPucker,
      weights.lipFunnel,
      weights.lipStretch,
      weights.mouthStretch,
      weights.upperLipRaise,
      weights.lowerLipDepress,
    );
    const tongueValue = Math.max(
      weights.tongueTipUp,
      weights.tongueTipLateral,
      weights.tongueBladeUp,
      weights.tongueBladeGroove,
      weights.tongueBetweenTeeth,
      weights.tongueDorsumUp,
      weights.tongueBodyHigh,
      weights.tongueBodyBack,
      weights.tongueBodyLow,
      weights.tongueForward,
      weights.tongueRetract,
      weights.contactDental,
      weights.contactAlveolar,
      weights.contactLateral,
      weights.contactVelar,
    );
    this.jawMeter.style.setProperty('--meter', weights.jawOpen.toFixed(3));
    this.lipMeter.style.setProperty('--meter', lipValue.toFixed(3));
    this.tongueMeter.style.setProperty('--meter', tongueValue.toFixed(3));
  }

  private renderDisclosures(): void {
    requireElement<HTMLElement>('#voice-disclosure').textContent = SPEECH_DISCLOSURE.voice;
    requireElement<HTMLElement>('#timing-disclosure').textContent = SPEECH_DISCLOSURE.timing;
  }

  private saveElevenLabsApiKey(): void {
    const key = this.apiKeyInput.value.trim();
    if (!key) {
      this.apiKeyStatus.textContent = '请先粘贴 API 密钥';
      this.apiKeyInput.setAttribute('aria-invalid', 'true');
      this.apiKeyInput.focus();
      return;
    }
    try {
      storeElevenLabsApiKey(key);
      this.apiKeyInput.value = '';
      this.apiKeyInput.removeAttribute('aria-invalid');
      this.renderApiKeyState('已保存在此浏览器中');
      this.status.textContent = 'API 密钥已保存,可以生成短语了。';
      this.status.dataset.state = 'idle';
    } catch (error) {
      this.apiKeyInput.setAttribute('aria-invalid', 'true');
      this.apiKeyStatus.textContent = error instanceof Error
        ? error.message
        : '此浏览器无法保存该 API 密钥。';
    }
  }

  private clearElevenLabsApiKey(): void {
    clearStoredElevenLabsApiKey();
    this.apiKeyInput.value = '';
    this.apiKeyInput.removeAttribute('aria-invalid');
    this.renderApiKeyState('API 密钥已移除');
    this.status.textContent = '添加 API 密钥后生成短语。';
    this.status.dataset.state = 'idle';
  }

  private renderApiKeyState(statusMessage?: string): void {
    const key = getStoredElevenLabsApiKey();
    const configured = Boolean(key);
    this.apiKeyManager.dataset.configured = String(configured);
    this.apiKeyStatus.textContent = statusMessage
      ?? (configured ? '可以直接播放' : '需要 API 密钥');
    this.apiKeyMask.textContent = configured && key
      ? maskElevenLabsApiKey(key)
      : '未配置';
    this.clearApiKeyButton.disabled = !configured;
    this.saveApiKeyButton.disabled = this.apiKeyInput.value.trim().length === 0;
    this.speakButton.disabled = this.speechSnapshot.state === 'loading' || !configured;
    const label = this.speakButton.querySelector('span');
    if (label) label.textContent = configured ? '生成并播放' : '添加 API 密钥后生成';
  }

  private updateCharacterCount(): void {
    if (this.phraseInput.value.length > MAX_TEXT_LENGTH) {
      this.phraseInput.value = this.phraseInput.value.slice(0, MAX_TEXT_LENGTH);
    }
    this.count.textContent = `${this.phraseInput.value.length} / ${MAX_TEXT_LENGTH}`;
  }

  private onLoadProgress(progress: PortraitLoadProgress): void {
    const ratio = progress.ratio ?? Math.min(0.92, progress.loaded / 1_200_000);
    this.loadingBar.style.setProperty('--progress', ratio.toFixed(3));
    this.loadingLabel.textContent = `正在加载原生 GNM 解剖结构 · ${Math.round(ratio * 100)}%`;
  }

  private publishDiagnostics(elapsed: number): void {
    const frameTimeMs = this.smoothedFrameTimeMs;
    const fps = 1000 / Math.max(0.001, frameTimeMs);
    const oral = this.portrait.getOralDiagnostics();
    const canvas = this.portrait.getCanvasDiagnostics();
    const renderer = this.portrait.getRendererDiagnostics();
    const expression = this.expressiveFrame?.diagnostics;
    document.body.dataset.frameTimeMs = frameTimeMs.toFixed(2);
    document.body.dataset.fps = fps.toFixed(1);
    document.body.dataset.renderCalls = String(renderer.calls);
    document.body.dataset.renderTriangles = String(renderer.triangles);
    document.body.dataset.renderGeometries = String(renderer.geometries);
    document.body.dataset.renderTextures = String(renderer.textures);
    document.body.dataset.expressionAffect = expression?.affect ?? 'neutral';
    document.body.dataset.expressionIntensity = (expression?.intensity ?? 0).toFixed(3);
    document.body.dataset.expressionAct = expression?.discourseAct ?? 'statement';
    document.body.dataset.expressionSource = expression?.intentSource ?? 'text-fallback';
    document.body.dataset.expressionConfidence = (expression?.intentConfidence ?? 0).toFixed(3);
    document.body.dataset.expressionEnvelope = expression?.envelopePhase ?? 'idle';
    document.body.dataset.expressionMaximum = (expression?.maximumMorphWeight ?? 0).toFixed(3);
    document.body.dataset.expressionGaze = expression?.gazeState ?? this.localAgentState;
    document.body.dataset.expressionBlink = expression?.blinkPhase ?? 'open';
    document.body.dataset.expressionCues = String(expression?.cueCount ?? 0);
    document.body.dataset.expressionPlannerMs = (expression?.plannerMs ?? 0).toFixed(2);
    document.body.dataset.expressionHeadPitch = (
      this.expressiveFrame?.headPitch ?? 0
    ).toFixed(4);
    document.body.dataset.expressionHeadYaw = (
      this.expressiveFrame?.headYaw ?? 0
    ).toFixed(4);
    document.body.dataset.expressionHeadRoll = (
      this.expressiveFrame?.headRoll ?? 0
    ).toFixed(4);
    document.body.dataset.performanceAction = expression?.actionGesture ?? 'none';
    document.body.dataset.performanceActionPhase = expression?.actionPhase ?? 'idle';
    window.__GNM_AVATAR_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed,
      loaded: this.portrait.isLoaded(),
      speechState: this.previewState ? 'preview' : this.speechSnapshot.state,
      previewState: this.previewState ?? null,
      activeGesture: this.gesture.textContent ?? '发音器官静止',
      timing: {
        frameTimeMs,
        fps,
      },
      expression: expression ?? null,
      headMotion: {
        pitch: this.expressiveFrame?.headPitch ?? 0,
        yaw: this.expressiveFrame?.headYaw ?? 0,
        roll: this.expressiveFrame?.headRoll ?? 0,
      },
      oral,
      renderer,
      canvas,
    };
  }
}
