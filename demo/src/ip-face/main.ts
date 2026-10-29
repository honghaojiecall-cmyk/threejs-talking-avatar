import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface MouthPose {
  open: number;
  wide: number;
  round: number;
  smile: number;
}

const VISEME_POSES: Record<string, MouthPose> = {
  rest: { open: 0.06, wide: 0.9, round: 0.2, smile: 0.25 },
  AA: { open: 0.95, wide: 1.0, round: 0.1, smile: 0.0 },
  EE: { open: 0.35, wide: 1.2, round: 0.0, smile: 0.6 },
  OO: { open: 0.6, wide: 0.55, round: 1.0, smile: 0.0 },
  MBP: { open: 0.0, wide: 0.85, round: 0.3, smile: 0.15 },
  FV: { open: 0.18, wide: 0.95, round: 0.0, smile: 0.0 },
  L: { open: 0.4, wide: 1.05, round: 0.0, smile: 0.3 },
};

const params = new URLSearchParams(location.search);
const fixedMouth = params.get('mouth');
const animateMouth = params.get('animate') !== '0' && !fixedMouth;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141f);
scene.environment = new THREE.PMREMGenerator(renderer)
  .fromScene(new RoomEnvironment(), 0.04)
  .texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(2, 3, 4);
scene.add(keyLight);

const FACE_W = 1024;

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
const FACE_H = 720;
const faceCanvas = document.createElement('canvas');
faceCanvas.width = FACE_W;
faceCanvas.height = FACE_H;
const faceCtx = faceCanvas.getContext('2d')!;
const faceTexture = new THREE.CanvasTexture(faceCanvas);
faceTexture.flipY = false;
faceTexture.colorSpace = THREE.SRGBColorSpace;

let currentPose: MouthPose = { ...VISEME_POSES.rest };
let targetPose: MouthPose = { ...VISEME_POSES.rest };
let eyeOpen = 1;
let blinkClock = 1.5;

function drawFace(): void {
  const ctx = faceCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, FACE_W, FACE_H);
  const sg = ctx.createLinearGradient(0, 0, 0, FACE_H);
  sg.addColorStop(0, '#1a36a8');
  sg.addColorStop(0.55, '#142674');
  sg.addColorStop(1, '#070f38');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, FACE_W, FACE_H);

  ctx.setTransform(0.6, 0, 0, 0.72, (0.62 - 0.5 * 0.6) * FACE_W, 0.28 * FACE_H);

  const glow = '#c4f0ff';
  const gradient = ctx.createLinearGradient(0, FACE_H * 0.15, 0, FACE_H * 0.85);
  gradient.addColorStop(0, '#5fb4ff');
  gradient.addColorStop(1, glow);
  ctx.fillStyle = gradient;
  ctx.strokeStyle = gradient;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 18;

  const eyeY = FACE_H * 0.38;
  const eyeDX = FACE_W * 0.2;
  const cx = FACE_W / 2;
  const eyeW = FACE_W * 0.225;
  const eyeH = FACE_H * 0.22 * Math.max(0.06, eyeOpen);
  const eyeMask = currentPose.smile > 0.55 ? EYE_MASK_SMILE : EYE_MASK;
  const eyeCols = eyeMask[0].length;
  const eyeRows = eyeMask.length;
  const pitchX = eyeW / eyeCols;
  const pitchY = eyeH / eyeRows;
  for (const side of [-1, 1]) {
    const ex = cx + side * eyeDX;
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

  const mouthY = FACE_H * 0.72;
  const mouthW = FACE_W * 0.2 * currentPose.wide * (1 - currentPose.round * 0.35);
  const mouthH = FACE_H * 0.03 + FACE_H * 0.24 * currentPose.open * (1 - currentPose.round * 0.25);
  const cornerLift = currentPose.smile * FACE_H * 0.06;
  ctx.beginPath();
  if (currentPose.open < 0.08) {
    ctx.lineWidth = FACE_H * 0.035;
    ctx.lineCap = 'round';
    ctx.moveTo(cx - mouthW / 2, mouthY - cornerLift);
    ctx.quadraticCurveTo(cx, mouthY + FACE_H * 0.05 + cornerLift * 0.4, cx + mouthW / 2, mouthY - cornerLift);
    ctx.stroke();
  } else {
    const r = Math.min(mouthW, mouthH) / 2 + currentPose.round * FACE_H * 0.06;
    ctx.roundRect(cx - mouthW / 2, mouthY - mouthH / 2 - cornerLift * 0.3, mouthW, mouthH, r);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  faceTexture.needsUpdate = true;
}

const gltf = await new GLTFLoader().loadAsync('/assets/models/newip.glb');
const model = gltf.scene;
model.scale.setScalar(0.01);
scene.add(model);

const modelBox = new THREE.Box3().setFromObject(model);
const modelCenter = modelBox.getCenter(new THREE.Vector3());
model.position.sub(modelCenter);

let headBone: THREE.Object3D | null = null;
let headRestQuat: THREE.Quaternion | null = null;
let faceMesh: THREE.Mesh | null = null;
model.traverse((obj) => {
  if (obj.name === 'Head_00_jnt') {
    headBone = obj;
    headRestQuat = obj.quaternion.clone();
  }
  if ((obj as THREE.Mesh).isMesh && (obj.name === 'FaceScreen' || obj.name === '空白1-Oc光泽21')) {
    faceMesh = obj as THREE.Mesh;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x05070c,
      roughness: 0.35,
      metalness: 0.0,
      emissive: 0xffffff,
      emissiveMap: faceTexture,
      emissiveIntensity: 1.6,
    });
    (faceMesh as THREE.Mesh).material = mat;
  }
});

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 50);
{
  const fc = new THREE.Vector3(0.024, 0.06, 0.418);
  const fitH = 0.558 * 1.6;
  const dist = fitH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + 0.2;
  camera.position.set(fc.x, fc.y + 0.04, fc.z + dist);
  camera.lookAt(fc);
  const cy = parseFloat(params.get('cy') ?? 'NaN');
  const cz = parseFloat(params.get('cz') ?? 'NaN');
  if (!Number.isNaN(cy)) camera.position.y = cy;
  if (!Number.isNaN(cz)) camera.position.z = cz;
}

const visemeCycle: string[] = ['AA', 'EE', 'OO', 'MBP', 'FV', 'L'];
let cycleIndex = 0;
let cycleClock = 0;
const headEuler = new THREE.Euler();
const headOffsetQuat = new THREE.Quaternion();

const clock = new THREE.Clock();
function tick(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (fixedMouth && VISEME_POSES[fixedMouth]) {
    targetPose = VISEME_POSES[fixedMouth];
  } else if (animateMouth) {
    cycleClock += dt;
    if (cycleClock > 0.55) {
      cycleClock = 0;
      cycleIndex = (cycleIndex + 1) % visemeCycle.length;
      targetPose = VISEME_POSES[visemeCycle[cycleIndex]];
    }
  }
  const ease = 1 - Math.exp(-dt * 14);
  currentPose.open += (targetPose.open - currentPose.open) * ease;
  currentPose.wide += (targetPose.wide - currentPose.wide) * ease;
  currentPose.round += (targetPose.round - currentPose.round) * ease;
  currentPose.smile += (targetPose.smile - currentPose.smile) * ease;

  blinkClock -= dt;
  if (blinkClock < 0) blinkClock = 2.2 + Math.random() * 2.4;
  const blinkPhase = blinkClock < 0.16 ? blinkClock / 0.16 : 1;
  eyeOpen = blinkPhase < 0.5 ? 1 - blinkPhase * 2 : blinkPhase * 2 - 1;

  drawFace();

  if (headBone && headRestQuat) {
    const speaking = animateMouth || fixedMouth;
    const nod = speaking ? Math.sin(t * 5.2) * 0.03 * (0.4 + currentPose.open) : 0;
    headEuler.set(
      Math.sin(t * 0.9) * 0.02 + nod,
      Math.sin(t * 0.6) * 0.05,
      Math.sin(t * 0.45) * 0.015,
    );
    headOffsetQuat.setFromEuler(headEuler);
    (headBone as THREE.Object3D).quaternion.copy(headRestQuat).multiply(headOffsetQuat);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

drawFace();
tick();
(window as unknown as { __READY__: boolean }).__READY__ = true;
(window as unknown as Record<string, unknown>).__DBG__ = { scene, faceMesh, faceCanvas, camera, THREE };
