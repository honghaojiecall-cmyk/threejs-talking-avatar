import type { PhonemeInterval } from '../../speech/types';
import type { PreparedLocalSpeech } from '../../speech/SpeechController';

export type LocalTtsEngine =
  | 'kokoro'
  | 'kokoro-timestamped'
  | 'supertonic-2'
  | 'kitten-tts-nano';

export type LocalTtsBackend = 'wasm' | 'webgpu';

export type LocalTtsPreset = 'standard' | 'instant' | 'quality';

export interface LocalTtsAudioChunk {
  text: string;
  /** IPA, or synthesis-native phone intervals when the engine exposes them. */
  phonemes: string | readonly PhonemeInterval[];
  audio: Float32Array;
  sampleRate: number;
  /**
   * AudioBuffer + lip-sync analysis prepared ahead of playback (while the
   * previous clause is still sounding) to keep clause transitions gapless.
   */
  prepared?: PreparedLocalSpeech;
}

export interface LocalTtsSynthesisResult {
  engine: LocalTtsEngine;
  backend: LocalTtsBackend;
  preset: LocalTtsPreset;
  chunks: readonly LocalTtsAudioChunk[];
  elapsedMs: number;
  audioDurationSeconds: number;
  realTimeFactor: number;
}
