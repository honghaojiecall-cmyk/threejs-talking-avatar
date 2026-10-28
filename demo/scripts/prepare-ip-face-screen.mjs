import { NodeIO, getBounds } from '@gltf-transform/core';
import { unpartition } from '@gltf-transform/functions';
import * as THREE from 'three';
import { resolve } from 'node:path';

const SOURCE = resolve('..', '科技风ip建模带骨骼', '科技风ip建模带骨骼.gltf');
const TARGET = resolve('public', 'assets', 'models', 'ip-screen.glb');

const io = new NodeIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

function worldBoundsOf(node) {
  return getBounds(node);
}

let faceNode = null;
let faceBounds = null;
for (const node of root.listNodes()) {
  const mesh = node.getMesh && node.getMesh();
  if (!mesh) continue;
  const b = worldBoundsOf(node);
  const width = b.max[0] - b.min[0];
  const centerZ = (b.min[2] + b.max[2]) / 2;
  if (width > 60 && centerZ > 25) {
    faceNode = node;
    faceBounds = b;
    break;
  }
}
if (!faceNode) throw new Error('Face screen panel not found.');
console.log(
  'face panel:',
  faceNode.getName(),
  'bounds min=',
  faceBounds.min.map((v) => +v.toFixed(2)),
  'max=',
  faceBounds.max.map((v) => +v.toFixed(2)),
);

faceNode.setName('FaceScreen');
const faceMesh = faceNode.getMesh();
faceMesh.setName('FaceScreen');

for (const prim of faceMesh.listPrimitives()) {
  const uv = prim.getAttribute('TEXCOORD_0');
  if (!uv) throw new Error('Face panel has no TEXCOORD_0.');
  const arr = uv.getArray().slice();
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i < arr.length; i += 2) {
    minU = Math.min(minU, arr[i]);
    maxU = Math.max(maxU, arr[i]);
    minV = Math.min(minV, arr[i + 1]);
    maxV = Math.max(maxV, arr[i + 1]);
  }
  const spanU = maxU - minU || 1;
  const spanV = maxV - minV || 1;
  for (let i = 0; i < arr.length; i += 2) {
    arr[i] = (arr[i] - minU) / spanU;
    arr[i + 1] = (arr[i + 1] - minV) / spanV;
  }
  uv.setArray(arr);
}

const faceMaterial = doc.createMaterial('FaceScreen');
faceMaterial
  .setBaseColorFactor([0.015, 0.02, 0.03, 1])
  .setEmissiveFactor([1, 1, 1])
  .setRoughnessFactor(0.35)
  .setMetallicFactor(0.0);
for (const prim of faceMesh.listPrimitives()) {
  prim.setMaterial(faceMaterial);
}

for (const node of root.listNodes()) {
  const mesh = node.getMesh && node.getMesh();
  if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (mat && mat !== faceMaterial) {
      mat.setRoughnessFactor(Math.min(0.85, mat.getRoughnessFactor() + 0.2));
    }
  }
}

const headJoint = root.listNodes().find((n) => n.getName() === 'Head_01_jnt');
if (!headJoint) throw new Error('Head_01_jnt not found.');

const earNodes = root.listNodes().filter(
  (n) => n.getName().startsWith('圆柱体') && n.getMesh(),
);
if (earNodes.length === 0) throw new Error('Ear cylinder nodes not found.');
const earInfo = earNodes.map((node) => {
  const b = getBounds(node);
  return {
    node,
    centerX: (b.min[0] + b.max[0]) / 2,
    centerZ: (b.min[2] + b.max[2]) / 2,
  };
});
const rightZ = earInfo.filter((e) => e.centerX > 0)
  .reduce((s, e) => s + e.centerZ, 0) / earInfo.filter((e) => e.centerX > 0).length;
const leftEars = earInfo.filter((e) => e.centerX < 0);
const leftZ = leftEars.reduce((s, e) => s + e.centerZ, 0) / leftEars.length;
const earShiftZ = rightZ - leftZ;
console.log('ears: rightZ=', rightZ.toFixed(1), 'leftZ=', leftZ.toFixed(1), 'shift left by', earShiftZ.toFixed(1));

const headWorldInverse = new THREE.Matrix4()
  .fromArray(headJoint.getWorldMatrix())
  .invert();
for (const { node } of earInfo) {
  const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  if (earInfo.find((e) => e.node === node).centerX < 0) {
    world.elements[14] += earShiftZ;
  }
  const local = world.premultiply(headWorldInverse);
  headJoint.addChild(node);
  node.setMatrix(local.elements);
}
console.log('reparented', earInfo.length, 'ear nodes under Head_01_jnt');

await doc.transform(unpartition());
await io.write(TARGET, doc);
console.log('wrote', TARGET);
