import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import type { ExpressivePerformanceFrame, SpeechRigWeights } from '../speech';
import type { PortraitLoadProgress, PortraitRendererDiagnostics } from './MintAvatar';
import {
  computePortraitPose,
  previewPoseForState,
  type PoseTargets,
} from './portraitPose';

const MODEL_URL = '/assets/models/newip.glb';
const HEAD_BONE_NAME = 'Head_00_jnt';
const FACE_MESH_NAME = '空白1-Oc光泽21';
const FACE_CANVAS_W = 1024;
const FACE_CANVAS_H = 720;
const FACE_CENTER = new THREE.Vector3(0.024, 0.06, 0.418);

const EYE_MASK: readonly string[] = [
  '...XX...',
  'X.XXXX.X',
  '.XXXXXX.',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '..XXXX..',
  '...XX...',
];

const EYE_MASK_SMILE: readonly string[] = [
  'XXXXXXXX',
  'XXXXXXXX',
  'XX....XX',
  'XX....XX',
  'XX....XX',
  'XX....XX',
  'XX....XX',
  'XX....XX',
  'XX....XX',
];

const LIMB_BONES = {
  shoulderL: 'L_IK_Shoulder_jnt',
  shoulderR: 'R_IK_Shoulder_jnt',
  elbowL: 'L_IK_Elbow_jnt',
  elbowR: 'R_IK_Elbow_jnt',
} as const;
type LimbKey = keyof typeof LIMB_BONES;

export type CustomizePart = 'head' | 'body' | 'legs' | 'arms' | 'antennae' | 'ears' | 'wings';
export type FaceSticker = 'blush' | 'sparkle';
interface LimbDriver {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  current: THREE.Euler;
}

function clamp(value: number, max = 1): number {
  return THREE.MathUtils.clamp(value, 0, max);
}

interface FacePose {
  open: number;
  wide: number;
  round: number;
  smile: number;
  eyeOpen: number;
  gazeX: number;
  gazeY: number;
}

export class IpAvatar {
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
  private headBone: THREE.Object3D | null = null;
  private headRest: THREE.Quaternion | null = null;
  private armNodeL: THREE.Object3D | null = null;
  private armNodeR: THREE.Object3D | null = null;
  private wingNode: THREE.Object3D | null = null;
  private readonly armRestL = new THREE.Quaternion();
  private readonly armRestR = new THREE.Quaternion();
  private readonly wingRest = new THREE.Quaternion();
  private readonly armEuler = new THREE.Euler();
  private readonly armCurL = new THREE.Euler();
  private readonly armCurR = new THREE.Euler();
  private speechEnergy = 0;
  private readonly limbs = new Map<LimbKey, LimbDriver>();
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
  private currentHeadRot = new THREE.Euler();
  private readonly faceCanvas = document.createElement('canvas');
  private readonly faceCtx: CanvasRenderingContext2D;
  private readonly faceTexture: THREE.CanvasTexture;
  private readonly facePose: FacePose = {
    open: 0.06,
    wide: 0.9,
    round: 0.2,
    smile: 0.25,
    eyeOpen: 1,
    gazeX: 0,
    gazeY: 0,
  };
  private readonly partMeshes = new Map<CustomizePart, THREE.Mesh[]>();
  private readonly baseColors = new Map<THREE.Material, THREE.Color>();
  private faceGlowTop = '#5fb4ff';
  private faceGlowBottom = '#c4f0ff';
  private readonly stickers: Record<FaceSticker, boolean> = { blush: false, sparkle: false };
  private faceDirty = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onLoadProgress?: (progress: PortraitLoadProgress) => void,
  ) {
    this.renderer = createRenderer(canvas);
    this.scene.background = new THREE.Color(0x0a0d13);
    this.scene.add(this.portraitRoot);
    (window as unknown as Record<string, unknown>).__IP_AVATAR__ = this;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 4.5;
    this.controls.minPolarAngle = Math.PI * 0.35;
    this.controls.maxPolarAngle = Math.PI * 0.65;
    this.controls.minAzimuthAngle = -0.6;
    this.controls.maxAzimuthAngle = 0.6;

    this.faceCanvas.width = FACE_CANVAS_W;
    this.faceCanvas.height = FACE_CANVAS_H;
    const ctx = this.faceCanvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable for the IP face.');
    this.faceCtx = ctx;
    this.faceTexture = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTexture.flipY = false;
    this.faceTexture.colorSpace = THREE.SRGBColorSpace;

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

    const model = gltf.scene;
    model.scale.setScalar(0.01);
    this.portraitRoot.add(model);
    const modelBox = new THREE.Box3().setFromObject(model);
    const modelCenter = modelBox.getCenter(new THREE.Vector3());
    model.position.sub(modelCenter);

    model.traverse((object) => {
      if (object.name === HEAD_BONE_NAME) {
        this.headBone = object;
        this.headRest = object.quaternion.clone();
      }
      if (object.name === '翅膀') {
        this.wingNode = object;
        this.wingRest.copy(object.quaternion);
      }
      if (object instanceof THREE.Mesh) {
        object.frustumCulled = false;
        if (object.name === FACE_MESH_NAME) {
          object.material = new THREE.MeshStandardMaterial({
            color: 0x05070c,
            roughness: 0.35,
            metalness: 0.0,
            emissive: 0xffffff,
            emissiveMap: this.faceTexture,
            emissiveIntensity: 1.6,
          });
        } else {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material instanceof THREE.MeshStandardMaterial) {
              material.metalness = Math.min(material.metalness, 0.2);
              material.roughness = Math.max(material.roughness, 0.6);
              if (material.transparent) material.depthWrite = true;
            }
          }
        }
      }
    });
    if (!this.headBone) throw new Error('The IP asset is missing its head bone.');

    const partMeshNames: Record<CustomizePart, string[]> = {
      head: ['空白1-Oc光泽11', '空白1-Oc光泽1002', '空白1-Oc光泽61'],
      antennae: ['空白1-Oc光泽6', '空白1-Oc光泽1003'],
      ears: [],
      body: [],
      legs: [],
      arms: [],
      wings: ['翅膀'],
    };
    const partRoots: Partial<Record<CustomizePart, string[]>> = {
      ears: ['圆柱体'],
      legs: ['圆柱体-Oc光泽11', '圆柱体-Oc光泽1003'],
      body: ['细分曲面003'],
      arms: ['扫描001', '扫描'],
    };
    for (const [part, roots] of Object.entries(partRoots) as [CustomizePart, string[]][]) {
      for (const rootName of roots) {
        const root = model.getObjectByName(rootName);
        root?.traverse((object) => {
          if (object instanceof THREE.Mesh) partMeshNames[part].push(object.name);
        });
      }
    }
    for (const [part, names] of Object.entries(partMeshNames) as [CustomizePart, string[]][]) {
      const meshes = names
        .map((name) => model.getObjectByName(name))
        .filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
      this.partMeshes.set(part, meshes);
    }

    const armGroups = ['空白', '空白003']
      .map((name) => model.getObjectByName(name))
      .filter((object): object is THREE.Object3D => Boolean(object));
    const worldPos = new THREE.Vector3();
    for (const group of armGroups) {
      group.getWorldPosition(worldPos);
      if (worldPos.x > 0) {
        this.armNodeL = group;
        this.armRestL.copy(group.quaternion);
      } else {
        this.armNodeR = group;
        this.armRestR.copy(group.quaternion);
      }
    }

    for (const key of Object.keys(LIMB_BONES) as LimbKey[]) {
      const bone = model.getObjectByName(LIMB_BONES[key]);
      if (bone) {
        this.limbs.set(key, {
          bone,
          rest: bone.quaternion.clone(),
          current: new THREE.Euler(),
        });
      }
    }

    this.frameCamera();
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
    this.previewPose = previewPoseForState(name);
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

    const pose = this.debugPose ?? this.previewPose ?? computePortraitPose(
      this.speechWeights,
      this.performanceFrame,
    );
    this.applyPose(pose, deltaSeconds, elapsed);
    if (this.faceDirty) this.drawFace();
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
    this.faceTexture.dispose();
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
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x86b4ff, 1.5);
    rim.position.set(-1.2, 1.6, -1.4);
    this.scene.add(rim);
  }

  private frameCamera(): void {
    this.controls.target.set(FACE_CENTER.x, 0.28, 0.3);
    this.camera.position.set(FACE_CENTER.x, 0.3, 3.4);
    this.camera.fov = 28;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private applyPose(pose: PoseTargets, deltaSeconds: number, elapsed: number): void {
    const jaw = clamp(pose.jaw ?? 0);
    const bilabial = clamp(pose.bilabial ?? 0);
    const round = clamp(pose.round ?? 0) * (1 - bilabial * 0.5);
    const stretch = clamp(pose.stretch ?? 0);
    const cornersUp = clamp(pose.cornersUp ?? 0) + clamp(pose.smile ?? 0) * 0.4;
    const cornersDown = clamp(pose.cornersDown ?? 0);
    const blink = clamp(pose.blink ?? 0);
    const squint = clamp(pose.squint ?? 0);
    const widen = clamp(pose.widen ?? 0);
    const gazeX = THREE.MathUtils.clamp(
      (pose.gazeX ?? 0) + (this.reducedMotion ? 0 : this.pointer.x * 0.35), -1, 1);
    const gazeY = THREE.MathUtils.clamp(
      (pose.gazeY ?? 0) + (this.reducedMotion ? 0 : this.pointer.y * 0.25), -1, 1);

    const gestureSmile = this.performanceFrame?.diagnostics.actionGesture === 'smile' ? 1 : 0;
    const target: FacePose = {
      open: clamp(jaw * (1 - bilabial)),
      wide: 0.85 + stretch * 0.45 - round * 0.3,
      round,
      smile: Math.max(clamp(0.2 + cornersUp - cornersDown * 0.8, 0), gestureSmile * 0.95),
      eyeOpen: THREE.MathUtils.clamp(1 - blink - squint * 0.5 + widen * 0.25, 0.04, 1.25),
      gazeX,
      gazeY,
    };
    const ease = 1 - Math.exp(-deltaSeconds * 16);
    const current = this.facePose;
    for (const key of Object.keys(target) as (keyof FacePose)[]) {
      const next = current[key] + (target[key] - current[key]) * ease;
      if (Math.abs(next - current[key]) > 0.0005) this.faceDirty = true;
      current[key] = next;
    }

    const idleSway = this.reducedMotion ? 0 : Math.sin(elapsed * 0.6) * 0.008;
    this.updateHeadRotation(deltaSeconds, idleSway);
    this.updateLimbs(pose, deltaSeconds, elapsed);
    this.updateBody(pose, deltaSeconds, elapsed);
  }

  private updateBody(pose: PoseTargets, deltaSeconds: number, elapsed: number): void {
    const energyTarget = this.reducedMotion ? 0 : clamp((pose.jaw ?? 0) * 1.6);
    this.speechEnergy = THREE.MathUtils.lerp(
      this.speechEnergy, energyTarget, 1 - Math.exp(-deltaSeconds * 8));
    const gesture = this.performanceFrame?.diagnostics.actionGesture;
    const surprise = gesture === 'surprise' ? 1 : 0;
    const gestureWave = gesture === 'wave' ? 1 : 0;
    const excited = gesture === 'smile' || surprise || gestureWave ? 1 : 0;
    const curious = gesture === 'curiosity' ? 1 : 0;
    const concern = gesture === 'concern' ? 1 : 0;
    const jump = gesture === 'jump' ? 1 : 0;
    const wave = Math.max(clamp(pose.wave ?? 0), gestureWave);
    const still = this.reducedMotion ? 0 : 1;

    const bobAmp = (0.012 * this.speechEnergy + 0.05 * jump) * still;
    this.portraitRoot.position.y =
      Math.abs(Math.sin(elapsed * (jump ? 6.5 : 5.2))) * bobAmp;

    const swing = Math.sin(elapsed * 5.2) * 0.12 * this.speechEnergy * still;
    const swingAlt = Math.sin(elapsed * 5.2 + Math.PI) * 0.12 * this.speechEnergy * still;
    const breathe = Math.sin(elapsed * 0.8) * 0.05 * still;
    const outward = 0.18 * this.speechEnergy;
    const waveShake = wave * Math.sin(elapsed * 7.2) * 0.25 * still;

    const damping = 1 - Math.exp(-deltaSeconds * 6);
    this.armCurL.x = THREE.MathUtils.lerp(this.armCurL.x, swing, damping);
    this.armCurL.z = THREE.MathUtils.lerp(
      this.armCurL.z, breathe - outward - 0.95 * surprise - 0.05 * concern, damping);
    this.armCurR.x = THREE.MathUtils.lerp(
      this.armCurR.x, swingAlt + 0.35 * wave, damping);
    this.armCurR.z = THREE.MathUtils.lerp(
      this.armCurR.z,
      -breathe - outward - 0.95 * surprise - 0.4 * curious - 0.05 * concern
        - wave * 0.85 + waveShake,
      damping);

    if (this.armNodeL) {
      this.armEuler.set(this.armCurL.x, 0, this.armCurL.z);
      this.workQuat.setFromEuler(this.armEuler);
      this.armNodeL.quaternion.copy(this.armRestL).multiply(this.workQuat);
    }
    if (this.armNodeR) {
      this.armEuler.set(this.armCurR.x, 0, this.armCurR.z);
      this.workQuat.setFromEuler(this.armEuler);
      this.armNodeR.quaternion.copy(this.armRestR).multiply(this.workQuat);
    }
    if (this.wingNode) {
      const flutter = Math.sin(elapsed * 6.2) * (0.06 + 0.14 * this.speechEnergy + 0.2 * excited) * still;
      this.armEuler.set(0, flutter, 0);
      this.workQuat.setFromEuler(this.armEuler);
      this.wingNode.quaternion.copy(this.wingRest).multiply(this.workQuat);
    }

  }

  private updateLimbs(pose: PoseTargets, deltaSeconds: number, elapsed: number): void {
    const gesture = this.performanceFrame?.diagnostics.actionGesture;
    const emphasis = gesture === 'emphasis' ? 1 : 0;
    const surprise = gesture === 'surprise' ? 1 : 0;
    const curious = gesture === 'curiosity' ? 1 : 0;
    const concern = gesture === 'concern' ? 1 : 0;
    const wave = clamp(pose.wave ?? 0);
    const still = this.reducedMotion ? 0 : 1;
    const breathe = Math.sin(elapsed * 0.8) * 0.03 * still;
    const breatheAlt = Math.sin(elapsed * 0.8 + 1.7) * 0.025 * still;
    const swing = Math.sin(elapsed * 5.2) * 0.14 * this.speechEnergy * still;
    const swingAlt = Math.sin(elapsed * 5.2 + Math.PI) * 0.14 * this.speechEnergy * still;

    const targets: Record<LimbKey, [number, number, number]> = {
      shoulderL: [
        breathe * 0.3 + swing * 0.6,
        0.35 * emphasis + 0.85 * surprise,
        -1.6 * (1 - surprise * 0.8) + breathe + swing * 0.3 - 0.15 * concern,
      ],
      shoulderR: [
        breatheAlt * 0.3 + swingAlt * 0.6,
        -0.35 * emphasis - 1.0 * wave - 0.85 * surprise - 0.4 * curious,
        1.6 * (1 - wave) * (1 - surprise * 0.8) + breatheAlt + swingAlt * 0.3 + 0.15 * concern,
      ],
      elbowL: [0, 0.15 * emphasis + 0.3 * surprise, 0],
      elbowR: [
        0,
        -0.15 * emphasis - (0.7 + Math.sin(elapsed * 7.2) * 0.35) * wave - 0.3 * surprise,
        0,
      ],
    };
    const damping = 1 - Math.exp(-deltaSeconds * 6);
    const axes = ['x', 'y', 'z'] as const;
    for (const [key, driver] of this.limbs) {
      const target = targets[key];
      axes.forEach((axis, i) => {
        const override = pose[`limb_${key}_${axis}`];
        if (override !== undefined) (target as number[])[i] = override;
      });
      driver.current.x = THREE.MathUtils.lerp(driver.current.x, target[0], damping);
      driver.current.y = THREE.MathUtils.lerp(driver.current.y, target[1], damping);
      driver.current.z = THREE.MathUtils.lerp(driver.current.z, target[2], damping);
      this.workQuat.setFromEuler(driver.current);
      driver.bone.quaternion.copy(driver.rest).multiply(this.workQuat);
    }
  }

  private updateHeadRotation(deltaSeconds: number, idleSway: number): void {
    if (!this.headBone || !this.headRest) return;
    const pointerX = this.reducedMotion ? 0 : this.pointer.x;
    const pointerY = this.reducedMotion ? 0 : this.pointer.y;
    const inspecting = this.inspectionYaw !== undefined;
    const frame = this.performanceFrame;
    const targetX = inspecting ? 0 : pointerY * -0.03 + (frame?.headPitch ?? 0);
    const targetY = inspecting ? 0 : pointerX * 0.06 + (frame?.headYaw ?? 0);
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
    this.portraitRoot.rotation.y = this.inspectionYaw ?? 0;
  }

  setPartColor(part: CustomizePart, color: string | null): void {
    const meshes = this.partMeshes.get(part);
    if (!meshes) return;
    for (const mesh of meshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (!this.baseColors.has(material)) {
          this.baseColors.set(material, material.color.clone());
        }
        if (color) material.color.set(color);
        else material.color.copy(this.baseColors.get(material)!);
      }
    }
  }

  setFaceGlowColor(which: 'top' | 'bottom', color: string | null): void {
    if (which === 'top') this.faceGlowTop = color ?? '#5fb4ff';
    else this.faceGlowBottom = color ?? '#c4f0ff';
    this.faceDirty = true;
  }

  setSticker(sticker: FaceSticker, enabled: boolean): void {
    this.stickers[sticker] = enabled;
    this.faceDirty = true;
  }

  resetCustomization(): void {
    for (const part of this.partMeshes.keys()) this.setPartColor(part, null);
    this.setFaceGlowColor('top', null);
    this.setFaceGlowColor('bottom', null);
    this.stickers.blush = false;
    this.stickers.sparkle = false;
    this.faceDirty = true;
  }

  private drawFace(): void {
    this.faceDirty = false;
    const ctx = this.faceCtx;
    const W = FACE_CANVAS_W;
    const H = FACE_CANVAS_H;
    const cx = W / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const screenGradient = ctx.createLinearGradient(0, 0, 0, H);
    screenGradient.addColorStop(0, '#1a36a8');
    screenGradient.addColorStop(0.55, '#142674');
    screenGradient.addColorStop(1, '#070f38');
    ctx.fillStyle = screenGradient;
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(0.6, 0, 0, 0.72, (0.53 - 0.5 * 0.6) * W, 0.28 * H);

    if (this.stickers.blush) {
      for (const side of [-1, 1]) {
        const bx = cx + side * W * 0.31;
        const by = H * 0.56;
        const blushGradient = ctx.createRadialGradient(bx, by, 0, bx, by, W * 0.055);
        blushGradient.addColorStop(0, 'rgba(255, 122, 152, 0.9)');
        blushGradient.addColorStop(1, 'rgba(255, 122, 152, 0)');
        ctx.fillStyle = blushGradient;
        ctx.beginPath();
        ctx.ellipse(bx, by, W * 0.055, H * 0.052, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const glow = this.faceGlowBottom;
    const gradient = ctx.createLinearGradient(0, H * 0.15, 0, H * 0.85);
    gradient.addColorStop(0, this.faceGlowTop);
    gradient.addColorStop(1, glow);
    ctx.fillStyle = gradient;
    ctx.strokeStyle = gradient;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;

    const pose = this.facePose;
    const gazeOffsetX = pose.gazeX * W * 0.03;
    const gazeOffsetY = -pose.gazeY * H * 0.04;
    const eyeY = H * 0.38 + gazeOffsetY;
    const eyeDX = W * 0.2;
    const eyeW = W * 0.225;
    const eyeH = H * 0.22 * Math.max(0.04, pose.eyeOpen);
    const eyeMask = pose.smile > 0.55 ? EYE_MASK_SMILE : EYE_MASK;
    const eyeCols = eyeMask[0].length;
    const eyeRows = eyeMask.length;
    const pitchX = eyeW / eyeCols;
    const pitchY = eyeH / eyeRows;
    for (const side of [-1, 1]) {
      const ex = cx + side * eyeDX + gazeOffsetX;
      for (let row = 0; row < eyeRows; row++) {
        for (let col = 0; col < eyeCols; col++) {
          if (eyeMask[row][col] !== 'X') continue;
          ctx.fillRect(
            ex + (col - (eyeCols - 1) / 2) * pitchX - pitchX * 0.4,
            eyeY + (row - (eyeRows - 1) / 2) * pitchY - pitchY * 0.4,
            pitchX * 0.8,
            pitchY * 0.8,
          );
        }
      }
    }

    const mouthY = H * 0.72 + gazeOffsetY * 0.4;
    const mouthW = W * 0.2 * pose.wide * (1 - pose.round * 0.35);
    const mouthH = H * 0.03 + H * 0.24 * pose.open * (1 - pose.round * 0.25);
    const cornerLift = pose.smile * H * 0.06;
    ctx.beginPath();
    if (pose.open < 0.08) {
      ctx.lineWidth = H * 0.035;
      ctx.lineCap = 'round';
      ctx.moveTo(cx - mouthW / 2 + gazeOffsetX, mouthY - cornerLift);
      ctx.quadraticCurveTo(
        cx + gazeOffsetX,
        mouthY + H * 0.05 + cornerLift * 0.4,
        cx + mouthW / 2 + gazeOffsetX,
        mouthY - cornerLift,
      );
      ctx.stroke();
    } else {
      const r = Math.min(mouthW, mouthH) / 2 + pose.round * H * 0.06;
      ctx.roundRect(
        cx - mouthW / 2 + gazeOffsetX,
        mouthY - mouthH / 2 - cornerLift * 0.3,
        mouthW,
        mouthH,
        r,
      );
      ctx.fill();
    }
    if (this.stickers.sparkle) {
      ctx.fillStyle = '#ffffff';
      const star = (sx: number, sy: number, r: number): void => {
        ctx.beginPath();
        ctx.moveTo(sx, sy - r);
        ctx.quadraticCurveTo(sx, sy, sx + r, sy);
        ctx.quadraticCurveTo(sx, sy, sx, sy + r);
        ctx.quadraticCurveTo(sx, sy, sx - r, sy);
        ctx.quadraticCurveTo(sx, sy, sx, sy - r);
        ctx.fill();
      };
      for (const side of [-1, 1]) {
        star(cx + side * (eyeDX + W * 0.1) + gazeOffsetX, eyeY - eyeH * 0.62, W * 0.02);
        star(cx + side * (eyeDX + W * 0.06) + gazeOffsetX, eyeY + eyeH * 0.66, W * 0.011);
      }
    }
    ctx.shadowBlur = 0;
    this.faceTexture.needsUpdate = true;
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
