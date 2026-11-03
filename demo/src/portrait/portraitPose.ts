import * as THREE from 'three';
import type { ExpressivePerformanceFrame, SpeechRigWeights } from '../speech';

export type PoseTargets = Record<string, number>;

function clamp(value: number, max = 1): number {
  return THREE.MathUtils.clamp(value, 0, max);
}

export function computePortraitPose(
  speechWeights: Readonly<SpeechRigWeights> | undefined,
  performanceFrame: Readonly<ExpressivePerformanceFrame> | undefined,
): PoseTargets {
  const w = speechWeights;
  const m = performanceFrame?.morphs;
  const pose: PoseTargets = {};
  if (w) {
    const bilabial = clamp(Math.max(w.lipsTogether, w.contactBilabial));
    const labiodental = clamp(Math.max(w.lowerLipToTeeth, w.contactLabiodental));
    const rounded = clamp(Math.max(w.lipPucker, w.lipFunnel, w.mouthO, w.mouthU, w.mouthR));
    const stretched = clamp(Math.max(
      w.lipStretch, w.mouthStretch, w.mouthE, w.mouthI, w.mouthIH, w.mouthSZ, w.mouthSHCH,
    ));
    const openVowel = clamp(Math.max(w.mouthAA, w.mouthAH, w.mouthO * 0.7));
    let jaw = clamp(
      w.jawOpen * 0.9 + openVowel * 0.5 + w.lowerLipDepress * 0.35 + rounded * 0.22,
    );
    jaw *= 1 - bilabial * 0.92;
    jaw = Math.max(jaw, labiodental * 0.14);
    pose.jaw = jaw;
    pose.bilabial = bilabial;
    pose.labiodental = labiodental;
    pose.round = rounded * (1 - bilabial);
    pose.stretch = stretched * (1 - bilabial * 0.7);
    pose.cornersUp = clamp(w.mouthCornersUp) * (1 - bilabial * 0.6);
    pose.cornersDown = clamp(w.mouthCornersDown) * (1 - bilabial * 0.6);
  }
  if (m) {
    pose.blink = clamp(Math.max(m.blinkLeft, m.blinkRight, m.eyeOpen));
    pose.squint = clamp(m.eyeSquint);
    pose.widen = clamp(m.eyeWiden);
    pose.gazeX = clamp(m.gazeRight) - clamp(m.gazeLeft);
    pose.gazeY = clamp(m.gazeUp) - clamp(m.gazeDown);
    pose.browLift = clamp(m.browLift + Math.max(m.browLiftLeft, m.browLiftRight) * 0.5);
    pose.browFurrow = clamp(Math.max(m.browFurrow, m.browConcern));
    const smile = clamp(Math.max(m.smile, m.smileMouth));
    pose.cornersUp = Math.max(pose.cornersUp ?? 0, smile * (1 - (pose.bilabial ?? 0) * 0.6));
    pose.smile = smile;
    const surprise = clamp(m.surpriseMouth);
    if (surprise > 0) {
      pose.jaw = Math.max(pose.jaw ?? 0, surprise * 0.5 * (1 - (pose.bilabial ?? 0)));
      pose.round = Math.max(pose.round ?? 0, surprise * 0.4);
    }
    const concern = clamp(m.concernMouth);
    if (concern > 0) {
      pose.cornersDown = Math.max(pose.cornersDown ?? 0, concern * 0.6);
    }
    const emphasis = clamp(m.emphasisMouth);
    if (emphasis > 0) {
      pose.stretch = Math.max(pose.stretch ?? 0, emphasis * 0.3);
    }
  } else {
    pose.blink = 0;
  }
  return pose;
}

export function previewPoseForState(name: string): PoseTargets {
  if (name === 'idle') {
    return {};
  } else if (name === 'speaking') {
    return { jaw: 0.4, stretch: 0.25 };
  } else if (name === 'bilabial-contact') {
    return { bilabial: 1 };
  } else if (name === 'labiodental-contact') {
    return { labiodental: 1, jaw: 0.08 };
  } else if (name === 'open-vowel') {
    return { jaw: 0.75, stretch: 0.1 };
  } else if (name === 'rounded-vowel') {
    return { jaw: 0.35, round: 0.85 };
  }
  throw new Error(`Unknown portrait preview state: ${name}`);
}
