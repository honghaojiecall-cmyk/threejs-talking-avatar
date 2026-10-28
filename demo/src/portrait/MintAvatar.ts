import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import type { ExpressivePerformanceFrame, SpeechRigWeights } from '../speech';

const MODEL_URL = '/assets/models/mint.glb';

export interface PortraitLoadProgress {
  loaded: number;
  total: number;
  ratio: number | null;
}

export interface PortraitRendererDiagnostics {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

interface BoneDriver {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  restPos: THREE.Vector3;
}

type PoseTargets = Record<string, number>;

function clamp(value: number, max = 1): number {
  return THREE.MathUtils.clamp(value, 0, max);
}

const BONE_NAMES = {
  head: 'Bip001-Head_076',
  neck: 'Bip001-Neck_075',
  jaw: 'mouth_0158',
  upperLipM: 'Bon_uplip_M_0167',
  upperLipL1: 'Bon_uplip01_L_0169',
  upperLipL2: 'Bon_uplip02_L_0171',
  upperLipR1: 'Bon_uplip01_R_0165',
  upperLipR2: 'Bon_uplip02_R_0163',
  lowerLipM: 'Bon_Lolip_M_0168',
  lowerLipL1: 'Bon_Lolip01_L_0170',
  lowerLipL2: 'Bon_Lolip02_L_0172',
  lowerLipR1: 'Bon_Lolip01_R_0166',
  lowerLipR2: 'Bon_Lolip02_R_0164',
  cornerL: 'Bon_colip_L_0173',
  cornerR: 'Bon_colip_R_0162',
  mouthCornerL: 'Bon_zuiba_L_0174',
  mouthCornerR: 'Bon_zuiba_R_0159',
  eyeballL: 'Bon_eyeball_L_0197',
  eyeballR: 'Bon_eyeball_R_0192',
  eyelidUpL: 'BON_eyelid_up_L_0196',
  eyelidUpR: 'BON_eyelid_up_R_0184',
  eyelidLoL: 'BON_eyelid_lo_L_0201',
  eyelidLoR: 'BON_eyelid_lo_R_0188',
  browInnerL: 'Bon_eyebrow01_L_0176',
  browMidL: 'Bon_eyebrow02_L_0175',
  browOuterL: 'Bon_eyebrow03_L_0177',
  browInnerR: 'Bon_eyebrow01_R_0181',
  browMidR: 'Bon_eyebrow02_R_0180',
  browOuterR: 'Bon_eyebrow03_R_0178',
} as const;

type BoneKey = keyof typeof BONE_NAMES;

const UPPER_LIP_KEYS: readonly BoneKey[] = [
  'upperLipM', 'upperLipL1', 'upperLipL2', 'upperLipR1', 'upperLipR2',
];
const LOWER_LIP_KEYS: readonly BoneKey[] = [
  'lowerLipM', 'lowerLipL1', 'lowerLipL2', 'lowerLipR1', 'lowerLipR2',
];
const LOWER_LIP_OUTER_KEYS: readonly BoneKey[] = [
  'lowerLipL2', 'lowerLipR2',
];
const UPPER_LIP_OUTER_KEYS: readonly BoneKey[] = [
  'upperLipL1', 'upperLipL2', 'upperLipR1', 'upperLipR2',
];
const BROW_KEYS: readonly BoneKey[] = [
  'browInnerL', 'browMidL', 'browOuterL', 'browInnerR', 'browMidR', 'browOuterR',
];

type BoneOffsets = Partial<Record<BoneKey, [number, number, number]>>;
export class MintAvatar {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
  private readonly controls: OrbitControls;
  private readonly portraitRoot = new THREE.Group();
  private readonly pointer = new THREE.Vector2();
  private readonly onPointerMove = (event: PointerEvent): void => this.handlePointerMove(event);
  private readonly onPointerLeave = (): void => {
    this.pointer.set(0, 0);
  };
  private readonly drivers = new Map<BoneKey, BoneDriver>();
  private headBone: THREE.Object3D | null = null;
  private speechWeights: Readonly<SpeechRigWeights> | undefined;
  private performanceFrame: Readonly<ExpressivePerformanceFrame> | undefined;
  private previewPose: PoseTargets | undefined;
  private debugPose: PoseTargets | undefined;
  private modelLoaded = false;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private pauseForScreenshot = false;
  private deterministicElapsed = 0;
  private inspectionYaw: number | undefined;
  private readonly headEuler = new THREE.Euler();
  private readonly workQuat = new THREE.Quaternion();
  private readonly workVec = new THREE.Vector3();
  private readonly workScale = new THREE.Vector3();
  private headRest: THREE.Quaternion | null = null;
  private headCenter = new THREE.Vector3(0, 1.4, 0);
  private currentHeadRot = new THREE.Euler();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onLoadProgress?: (progress: PortraitLoadProgress) => void,
  ) {
    this.renderer = createRenderer(canvas);
    this.scene.background = new THREE.Color(0x0a0d13);
    this.scene.add(this.portraitRoot);
    (window as unknown as Record<string, unknown>).__MINT_AVATAR__ = this;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.18;
    this.controls.maxDistance = 0.6;
    this.controls.minPolarAngle = Math.PI * 0.35;
    this.controls.maxPolarAngle = Math.PI * 0.65;
    this.controls.minAzimuthAngle = -0.6;
    this.controls.maxAzimuthAngle = 0.6;

    this.createStage();
    this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    this.canvas.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    this.resize(true);
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>(
      (resolve, reject) => {
        loader.load(
          MODEL_URL,
          resolve,
          (event) => {
            this.onLoadProgress?.({
              loaded: event.loaded,
              total: event.total,
              ratio: event.total > 0 ? event.loaded / event.total : null,
            });
          },
          reject,
        );
      },
    );

    this.portraitRoot.add(gltf.scene);
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = false;
        object.frustumCulled = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.metalness = Math.min(material.metalness, 0.35);
            material.roughness = Math.max(material.roughness, 0.55);
            if (material.transparent) material.depthWrite = true;
          }
        }
      }
    });

    for (const key of Object.keys(BONE_NAMES) as BoneKey[]) {
      const bone = gltf.scene.getObjectByName(BONE_NAMES[key]);
      if (!bone) continue;
      this.drivers.set(key, {
        bone,
        rest: bone.quaternion.clone(),
        restPos: bone.position.clone(),
      });
      if (key === 'head') {
        this.headBone = bone;
        this.headRest = bone.quaternion.clone();
      }
    }
    if (!this.headBone) throw new Error('The Mint asset is missing its head bone.');

    this.scene.updateMatrixWorld(true);
    this.headCenter = this.headBone.getWorldPosition(new THREE.Vector3());
    const eyeL = this.drivers.get('eyeballL')?.bone.getWorldPosition(new THREE.Vector3());
    const eyeR = this.drivers.get('eyeballR')?.bone.getWorldPosition(new THREE.Vector3());
    if (eyeL && eyeR) {
      this.headCenter.copy(eyeL.add(eyeR).multiplyScalar(0.5));
    }
    this.frameCamera(true);
    this.modelLoaded = true;
    this.onLoadProgress?.({ loaded: 1, total: 1, ratio: 1 });
  }

  setSpeechWeights(weights: Readonly<SpeechRigWeights>): void {
    this.speechWeights = weights;
  }

  setExpressivePerformance(frame: Readonly<ExpressivePerformanceFrame>): void {
    this.performanceFrame = frame;
  }

  clearPreviewState(): void {
    this.previewPose = undefined;
    this.debugPose = undefined;
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    if (enabled) this.pointer.set(0, 0);
  }

  setPausedForScreenshot(paused: boolean): void {
    this.pauseForScreenshot = paused;
  }

  setInspectionView(name: string): void {
    const yaws: Record<string, number> = {
      front: 0,
      'three-quarter-left': -Math.PI / 6,
      'three-quarter-right': Math.PI / 6,
      'profile-left': -Math.PI * 0.5,
      'profile-right': Math.PI * 0.5,
    };
    if (!(name in yaws)) throw new Error(`Unknown portrait inspection view: ${name}`);
    this.inspectionYaw = yaws[name];
  }

  setPreviewState(name: string): void {
    if (name === 'idle') {
      this.previewPose = {};
    } else if (name === 'speaking') {
      this.previewPose = { jaw: 0.4, stretch: 0.25 };
    } else if (name === 'bilabial-contact') {
      this.previewPose = { bilabial: 1 };
    } else if (name === 'labiodental-contact') {
      this.previewPose = { labiodental: 1, jaw: 0.08 };
    } else if (name === 'open-vowel') {
      this.previewPose = { jaw: 0.75, stretch: 0.1 };
    } else if (name === 'rounded-vowel') {
      this.previewPose = { jaw: 0.35, round: 0.85 };
    } else {
      throw new Error(`Unknown portrait preview state: ${name}`);
    }
  }

  /** QA-only: directly pose named driver channels, e.g. { jaw: 0.5, blink: 1 }. */
  debugPoseChannels(pose: PoseTargets | undefined): void {
    this.debugPose = pose;
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    const elapsed = this.pauseForScreenshot ? this.deterministicElapsed : elapsedSeconds;
    if (!this.pauseForScreenshot) this.deterministicElapsed = elapsedSeconds;
    this.resize(false);
    this.controls.enabled = !this.pauseForScreenshot;
    this.controls.update(deltaSeconds);

    const pose = this.debugPose ?? this.previewPose ?? this.computePose();
    this.applyPose(pose, deltaSeconds, elapsed);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  captureCanvasPng(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  isLoaded(): boolean {
    return this.modelLoaded;
  }

  getRendererDiagnostics(): PortraitRendererDiagnostics {
    const info = this.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }

  getOralDiagnostics(): null {
    return null;
  }

  getCanvasDiagnostics(): {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  } {
    const maxDpr = window.innerWidth <= 720 ? 1.5 : 2;
    return {
      clientWidth: this.canvas.clientWidth,
      clientHeight: this.canvas.clientHeight,
      width: this.canvas.width,
      height: this.canvas.height,
      dpr: Math.min(window.devicePixelRatio || 1, maxDpr),
    };
  }

  dispose(): void {
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.renderer.dispose();
  }

  private createStage(): void {
    const hemisphere = new THREE.HemisphereLight(0xdfe8ff, 0x1a1612, 1.15);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(0.9, 1.9, 1.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x86b4ff, 1.5);
    rim.position.set(-1.2, 1.6, -1.4);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3, 48),
      new THREE.ShadowMaterial({ opacity: 0.28 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private frameCamera(force: boolean): void {
    if (!force && !this.modelLoaded) return;
    this.controls.target.copy(this.headCenter).add(new THREE.Vector3(0, -0.035, 0));
    this.camera.position.copy(this.headCenter).add(new THREE.Vector3(0, 0, 0.52));
    this.camera.fov = 26;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private computePose(): PoseTargets {
    const w = this.speechWeights;
    const m = this.performanceFrame?.morphs;
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

  private applyPose(pose: PoseTargets, deltaSeconds: number, elapsed: number): void {
    const blink = clamp(pose.blink ?? 0);
    const squint = clamp(pose.squint ?? 0);
    const widen = clamp(pose.widen ?? 0);
    const jaw = clamp(pose.jaw ?? 0);
    const bilabial = clamp(pose.bilabial ?? 0);
    const labiodental = clamp(pose.labiodental ?? 0);
    const round = clamp(pose.round ?? 0) * (1 - bilabial * 0.5);
    const stretch = clamp(pose.stretch ?? 0);
    const cornersUp = clamp(pose.cornersUp ?? 0) + clamp(pose.smile ?? 0) * 0.4;
    const cornersDown = clamp(pose.cornersDown ?? 0);
    const browLift = clamp(pose.browLift ?? 0);
    const browFurrow = clamp(pose.browFurrow ?? 0);
    const gazeX = THREE.MathUtils.clamp(pose.gazeX ?? 0, -1, 1);
    const gazeY = THREE.MathUtils.clamp(pose.gazeY ?? 0, -1, 1);

    // Idle life: gentle breathing sway of the head when no explicit gesture.
    const idleSway = this.reducedMotion ? 0 : Math.sin(elapsed * 0.6) * 0.008;

    this.updateHeadRotation(deltaSeconds, idleSway);

    const offsets: BoneOffsets = {};
    const add = (key: BoneKey, x: number, y: number, z: number): void => {
      const entry = offsets[key] ?? (offsets[key] = [0, 0, 0]);
      entry[0] += x;
      entry[1] += y;
      entry[2] += z;
    };

    add('lowerLipM', 0, -0.008 * jaw, 0.002 * jaw);
    add('lowerLipL1', 0, -0.006 * jaw, 0.001 * jaw);
    add('lowerLipR1', 0, -0.006 * jaw, 0.001 * jaw);
    for (const key of LOWER_LIP_OUTER_KEYS) add(key, 0, -0.004 * jaw, 0.001 * jaw);
    add('upperLipM', 0, 0.003 * jaw, 0.001 * jaw);
    for (const key of UPPER_LIP_OUTER_KEYS) add(key, 0, 0.0015 * jaw, 0);
    add('mouthCornerL', 0, -0.002 * jaw, 0);
    add('mouthCornerR', 0, -0.002 * jaw, 0);

    for (const key of UPPER_LIP_KEYS) add(key, 0, -0.0028 * bilabial, 0.0005 * bilabial);
    for (const key of LOWER_LIP_KEYS) add(key, 0, 0.0028 * bilabial, 0.0005 * bilabial);
    for (const key of LOWER_LIP_KEYS) add(key, 0, 0.002 * labiodental, -0.001 * labiodental);

    for (const key of UPPER_LIP_KEYS) add(key, 0, 0, 0.0025 * round);
    for (const key of LOWER_LIP_KEYS) add(key, 0, 0, 0.0025 * round);
    add('cornerL', 0.002 * round, 0, 0.001 * round);
    add('cornerR', -0.002 * round, 0, 0.001 * round);

    const spread = stretch * 0.8 + cornersUp * 0.9 - cornersDown * 0.6;
    const lift = cornersUp * 0.9 - cornersDown * 0.7 - stretch * 0.15;
    add('cornerL', -0.0045 * spread, 0.004 * lift, 0);
    add('cornerR', 0.0045 * spread, 0.004 * lift, 0);
    add('mouthCornerL', -0.0035 * spread, 0.003 * lift, 0);
    add('mouthCornerR', 0.0035 * spread, 0.003 * lift, 0);

    const lidDown = THREE.MathUtils.clamp(blink + squint * 0.5 - widen * 0.3, -0.4, 1);
    add('eyelidUpL', 0, -0.012 * lidDown, 0.002 * Math.max(lidDown, 0));
    add('eyelidUpR', 0, -0.012 * lidDown, 0.002 * Math.max(lidDown, 0));
    add('eyelidLoL', 0, 0.004 * lidDown, 0.001 * Math.max(lidDown, 0));
    add('eyelidLoR', 0, 0.004 * lidDown, 0.001 * Math.max(lidDown, 0));

    add('eyeballL', 0.004 * gazeX, 0.003 * gazeY, 0);
    add('eyeballR', 0.004 * gazeX, 0.003 * gazeY, 0);

    for (const key of BROW_KEYS) add(key, 0, 0.004 * browLift, 0);
    add('browInnerL', 0, -0.003 * browFurrow, 0.001 * browFurrow);
    add('browInnerR', 0, -0.003 * browFurrow, 0.001 * browFurrow);
    add('browMidL', 0, -0.0012 * browFurrow, 0);
    add('browMidR', 0, -0.0012 * browFurrow, 0);

    this.applyBoneOffsets(offsets);
  }

  private applyBoneOffsets(offsets: BoneOffsets): void {
    for (const [key, driver] of this.drivers) {
      if (key === 'head' || key === 'neck') continue;
      driver.bone.quaternion.copy(driver.rest);
      driver.bone.position.copy(driver.restPos);
      const offset = offsets[key];
      if (!offset) continue;
      const parent = driver.bone.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(this.workQuat).invert();
      parent.getWorldScale(this.workScale);
      this.workVec
        .set(offset[0], offset[1], offset[2])
        .applyQuaternion(this.workQuat);
      this.workVec.x /= this.workScale.x;
      this.workVec.y /= this.workScale.y;
      this.workVec.z /= this.workScale.z;
      driver.bone.position.add(this.workVec);
    }
  }

  private updateHeadRotation(deltaSeconds: number, idleSway: number): void {
    if (!this.headBone || !this.headRest) return;
    const pointerX = this.reducedMotion ? 0 : this.pointer.x;
    const pointerY = this.reducedMotion ? 0 : this.pointer.y;
    const inspecting = this.inspectionYaw !== undefined;
    const frame = this.performanceFrame;
    const targetX = inspecting ? 0 : pointerY * -0.03 + (frame?.headPitch ?? 0);
    const targetY = inspecting ? this.inspectionYaw ?? 0 : pointerX * 0.06 + (frame?.headYaw ?? 0);
    const targetZ = inspecting ? 0 : pointerX * -0.01 + (frame?.headRoll ?? 0);

    const gesture = frame?.diagnostics.actionGesture;
    const rate = gesture === 'nod' || gesture === 'shake' ? 14 : gesture === 'emphasis' ? 8 : 4.5;
    const damping = 1 - Math.exp(-deltaSeconds * rate);
    this.currentHeadRot.x = THREE.MathUtils.lerp(this.currentHeadRot.x, targetX + idleSway, damping);
    this.currentHeadRot.y = THREE.MathUtils.lerp(this.currentHeadRot.y, targetY, damping);
    this.currentHeadRot.z = THREE.MathUtils.lerp(this.currentHeadRot.z, targetZ, damping);

    this.headEuler.set(this.currentHeadRot.x, this.currentHeadRot.y, this.currentHeadRot.z);
    this.workQuat.setFromEuler(this.headEuler);
    this.headBone.quaternion.copy(this.headRest).multiply(this.workQuat);
  }

  private handlePointerMove(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointer.set(
      THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
      THREE.MathUtils.clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1, 1),
    );
  }

  private resize(force: boolean): void {
    const mobile = window.innerWidth <= 760;
    const resized = resizeRenderer(this.renderer, this.camera, mobile ? 1.5 : 2);
    if (!force && !resized) return;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}
