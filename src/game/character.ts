import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Pose } from '../../shared/game';
import { MOVEMENT } from '../../shared/movement';

export interface AnimationState {
  phase?: number;
  wallSide?: number;
  handTarget?: THREE.Vector3;
}
export interface Character {
  group: THREE.Group;
  animate: (t: number, speed: number, pose: Pose, state?: AnimationState) => void;
}
/** Articulated athlete: hips, spine, shoulders, elbows, knees and ankles. Feet stay at model y=0. */
export function makeCharacter(color: string, ghost = false): Character {
  const group = new THREE.Group();
  group.name = 'Runner';
  const material = (base: string, roughness = 0.85, metalness = 0) =>
    new THREE.MeshStandardMaterial({
      color: ghost ? color : base,
      roughness,
      metalness,
      transparent: ghost,
      opacity: ghost ? 0.42 : 1,
      emissive: ghost ? color : '#000000',
      emissiveIntensity: ghost ? 0.22 : 0,
    });
  const jacket = material('#273337'),
    fabric = material('#424e50', 0.98),
    seams = material('#111d22'),
    accent = material(color, 0.65),
    skin = material('#b48d75', 0.9),
    rubber = material('#bac1b5');
  const mesh = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = !ghost;
    m.receiveShadow = !ghost;
    parent.add(m);
    return m;
  };
  const round = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ) =>
    mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(0.035, w / 5, h / 5, d / 5)),
      mat,
      parent,
      x,
      y,
      z,
    );
  const sphere = (
    r: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    scale?: number[],
  ) => {
    const m = mesh(new THREE.SphereGeometry(r, 16, 12), mat, parent, x, y, z);
    if (scale) m.scale.set(...(scale as [number, number, number]));
    return m;
  };
  const segment = (
    top: number,
    bottom: number,
    length: number,
    mat: THREE.Material,
    parent: THREE.Object3D,
  ) => mesh(new THREE.CylinderGeometry(top, bottom, length, 14), mat, parent, 0, -length / 2, 0);
  const joint = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const n = new THREE.Group();
    n.name = name;
    n.position.set(x, y, z);
    parent.add(n);
    return n;
  };
  const hips = joint('hips', group, 0, 0.94);
  sphere(0.19, fabric, hips, 0, -0.005, 0, [1, 0.7, 0.65]);
  const spine = joint('spine', hips, 0, 0.015);
  const torsoShape = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.155, 0),
      new THREE.Vector2(0.175, 0.1),
      new THREE.Vector2(0.185, 0.25),
      new THREE.Vector2(0.225, 0.4),
      new THREE.Vector2(0.21, 0.48),
      new THREE.Vector2(0.12, 0.55),
    ],
    20,
  );
  const torso = mesh(torsoShape, jacket, spine, 0, 0, 0);
  torso.scale.z = 0.65;
  // Technical jacket panels, zipper, subtle piping and an actual fabric collar.
  round(0.285, 0.19, 0.018, fabric, spine, 0, 0.37, 0.137);
  round(0.012, 0.45, 0.014, seams, spine, 0, 0.27, 0.15);
  round(0.14, 0.018, 0.022, accent, spine, -0.075, 0.42, 0.151);
  round(0.13, 0.018, 0.022, accent, spine, 0.08, 0.42, 0.151);
  round(0.07, 0.055, 0.02, accent, spine, -0.1, 0.31, 0.153);
  round(0.33, 0.035, 0.23, seams, spine, 0, 0.055, 0);
  mesh(new THREE.CylinderGeometry(0.087, 0.12, 0.1, 18, 1, true), jacket, spine, 0, 0.56, 0);
  const head = joint('head', spine, 0, 0.72, 0.015);
  sphere(0.145, skin, head, 0, 0, 0.015, [0.86, 1.14, 0.9]);
  const hood = mesh(
    new THREE.SphereGeometry(0.16, 24, 18, Math.PI * 0.78, Math.PI * 1.44),
    jacket,
    head,
    0,
    0.025,
    -0.023,
  );
  hood.scale.set(1, 1.13, 0.97);
  // Close-fitting hood and fabric face covering leave a narrow, natural eye opening.
  sphere(0.14, seams, head, 0, 0.082, -0.004, [0.94, 0.58, 0.96]);
  for (const sign of [-1, 1]) {
    round(0.037, 0.008, 0.009, seams, head, sign * 0.046, 0.031, 0.137);
    sphere(0.008, rubber, head, sign * 0.045, 0.012, 0.14, [1.3, 0.45, 0.4]);
    sphere(0.004, seams, head, sign * 0.045, 0.012, 0.144, [1, 0.8, 0.5]);
  }
  sphere(0.12, jacket, head, 0, -0.055, 0.048, [1.02, 0.73, 0.92]);
  round(0.036, 0.006, 0.006, accent, head, 0.056, -0.075, 0.142);
  const shoulders: THREE.Group[] = [],
    elbows: THREE.Group[] = [],
    thighs: THREE.Group[] = [],
    knees: THREE.Group[] = [],
    ankles: THREE.Group[] = [];
  for (const [i, sign] of [-1, 1].entries()) {
    const side = i === 0 ? 'left' : 'right';
    const arm = joint(`${side}Shoulder`, spine, sign * 0.235, 0.43, 0);
    shoulders.push(arm);
    sphere(0.087, jacket, arm, 0, -0.025, 0, [1, 1.15, 1]);
    segment(0.081, 0.06, 0.29, jacket, arm);
    round(0.026, 0.12, 0.14, accent, arm, sign * 0.077, -0.1, 0);
    const elbow = joint(`${side}Elbow`, arm, 0, -0.29);
    elbows.push(elbow);
    sphere(0.06, fabric, elbow, 0, 0, 0);
    segment(0.063, 0.043, 0.27, fabric, elbow);
    mesh(new THREE.CylinderGeometry(0.049, 0.05, 0.035, 12), accent, elbow, 0, -0.25, 0);
    const hand = round(0.084, 0.12, 0.065, seams, elbow, 0, -0.32, 0.015);
    hand.name = `${side}Hand`;
    // Thumb silhouette, and a close-fitting running glove.
    sphere(0.025, seams, elbow, -sign * 0.045, -0.305, 0.027, [0.7, 1.5, 0.9]);
    const thigh = joint(`${side}Hip`, hips, sign * 0.115, -0.01);
    thighs.push(thigh);
    segment(0.105, 0.075, 0.42, fabric, thigh);
    round(0.042, 0.18, 0.095, jacket, thigh, sign * 0.088, -0.12, 0.01);
    const knee = joint(`${side}Knee`, thigh, 0, -0.42);
    knees.push(knee);
    sphere(0.072, jacket, knee, 0, 0, 0.01, [0.92, 1, 1]);
    segment(0.073, 0.042, 0.42, fabric, knee);
    round(0.11, 0.09, 0.035, seams, knee, 0, -0.03, 0.065);
    mesh(new THREE.CylinderGeometry(0.045, 0.048, 0.045, 12), accent, knee, 0, -0.36, 0);
    const ankle = joint(`${side}Ankle`, knee, 0, -0.42);
    ankles.push(ankle);
    round(0.15, 0.105, 0.29, jacket, ankle, 0, -0.006, 0.065);
    round(0.158, 0.038, 0.307, rubber, ankle, 0, -0.059, 0.067);
    round(0.07, 0.016, 0.13, accent, ankle, 0, 0.047, 0.08);
  }
  let lastTime = 0,
    gait = 0,
    previousPose: Pose = 'idle',
    beganPose = 0;
  const down = new THREE.Vector3(0, -1, 0);
  const rollBounds = new THREE.Box3();
  const inverseGroup = new THREE.Matrix4();
  const relative = new THREE.Matrix4();
  const partBounds = new THREE.Box3();
  const rollParts: THREE.Mesh[] = [];
  group.traverse((part) => {
    if (part instanceof THREE.Mesh) {
      part.geometry.computeBoundingBox();
      rollParts.push(part);
    }
  });
  function groundRoll() {
    // Keep the tucked body's lowest point on the roof throughout its rotation.
    group.updateWorldMatrix(true, true);
    inverseGroup.copy(group.matrixWorld).invert();
    rollBounds.makeEmpty();
    for (const part of rollParts) {
      relative.multiplyMatrices(inverseGroup, part.matrixWorld);
      partBounds.copy(part.geometry.boundingBox!).applyMatrix4(relative);
      rollBounds.union(partBounds);
    }
    hips.position.y += 0.025 - rollBounds.min.y;
  }
  function plantArm(index: number, contact: THREE.Vector3) {
    // Two-bone IK: hands stay planted on the beam during the pull, while elbows bend.
    group.updateWorldMatrix(true, true);
    const target = spine.worldToLocal(group.localToWorld(contact.clone()));
    const arm = shoulders[index],
      elbow = elbows[index];
    const delta = target.clone().sub(arm.position),
      length = Math.min(0.555, Math.max(0.07, delta.length()));
    const direction = delta.normalize();
    const pole = new THREE.Vector3(index === 0 ? -0.4 : 0.4, -0.6, -0.5);
    pole.addScaledVector(direction, -pole.dot(direction)).normalize();
    const a = (0.29 ** 2 - 0.31 ** 2 + length ** 2) / (2 * length);
    const bend = direction
      .clone()
      .multiplyScalar(a)
      .addScaledVector(pole, Math.sqrt(Math.max(0, 0.29 ** 2 - a ** 2)));
    arm.quaternion.setFromUnitVectors(down, bend.clone().normalize());
    const lower = direction
      .clone()
      .multiplyScalar(length)
      .sub(bend)
      .applyQuaternion(arm.quaternion.clone().invert())
      .normalize();
    elbow.quaternion.setFromUnitVectors(down, lower);
  }
  return {
    group,
    animate: (t, speed, value, state = {}) => {
      const dt = Math.max(0, Math.min(0.1, t - lastTime));
      lastTime = t;
      if (value !== previousPose) {
        previousPose = value;
        beganPose = t;
      }
      const duration = value === 'roll' ? MOVEMENT.rollDuration : value === 'flip' ? 0.72 : 0.6;
      const phase = state.phase ?? Math.min(1, Math.max(0, (t - beganPose) / duration));
      gait += dt * (1.2 + Math.min(18, speed) * 0.12) * Math.PI * 2;
      const movement = Math.min(1, speed / 5),
        swing = Math.sin(gait);
      hips.position.set(0, 0.94 + Math.abs(Math.sin(gait)) * 0.035 * movement, 0);
      hips.rotation.set(0, Math.sin(gait) * 0.025 * movement, Math.sin(gait) * 0.025 * movement);
      spine.rotation.set(0.08 + Math.min(0.18, speed * 0.012), 0, 0);
      head.rotation.set(-0.08, Math.sin(t * 0.4) * (value === 'idle' ? 0.12 : 0.02), 0);
      for (let i = 0; i < 2; i++) {
        const cycle = i === 0 ? swing : -swing;
        shoulders[i].rotation.set(cycle * 0.65 * movement - 0.08, 0, i === 0 ? 0.08 : -0.08);
        elbows[i].rotation.set(-0.85 - Math.max(0, cycle) * 0.25, 0, 0);
        thighs[i].rotation.set(-cycle * 0.72 * movement, 0, 0);
        knees[i].rotation.set(0.08 + Math.max(0, -cycle) * 1.25 * movement, 0, 0);
        ankles[i].rotation.set(-Math.max(0, -cycle) * 0.25 * movement, 0, 0);
      }
      if (value === 'idle') {
        hips.position.y = 0.94 + Math.sin(t * 2) * 0.007;
        spine.rotation.x = 0.025;
      }
      if (value === 'jump' || value === 'fall') {
        hips.position.y = 0.94;
        spine.rotation.x = 0.12;
        thighs[0].rotation.x = -0.65;
        thighs[1].rotation.x = 0.22;
        knees[0].rotation.x = 0.9;
        knees[1].rotation.x = 0.55;
        shoulders[0].rotation.x = -0.65;
        shoulders[1].rotation.x = 0.3;
        if (value === 'fall') {
          shoulders[0].rotation.z = 0.4;
          shoulders[1].rotation.z = -0.4;
          thighs[0].rotation.x = -0.3;
        }
      }
      if (value === 'slide') {
        hips.position.y = 0.46;
        spine.rotation.x = -0.4;
        thighs[0].rotation.x = -1.3;
        knees[0].rotation.x = 1.65;
        thighs[1].rotation.x = -1.1;
        knees[1].rotation.x = 0.3;
        shoulders[0].rotation.x = 0.4;
        shoulders[1].rotation.x = 0.5;
      }
      if (value === 'dive') {
        hips.position.y = 0.86;
        hips.rotation.x = Math.min(1.25, 0.6 + phase * 0.75);
        spine.rotation.x = 0.06;
        for (let i = 0; i < 2; i++) {
          shoulders[i].rotation.set(-2.7, 0, i === 0 ? 0.12 : -0.12);
          elbows[i].rotation.x = -0.13;
          thighs[i].rotation.x = -0.03;
          knees[i].rotation.x = 0.3 + i * 0.2;
        }
      }
      if (value === 'roll' || value === 'flip') {
        const ground = value === 'roll';
        const tuck = Math.min(1, phase / 0.14, (1 - phase) / 0.14);
        hips.position.y = ground ? 0.94 - Math.max(0, tuck) * 0.37 : 1;
        hips.rotation.x = Math.PI * 2 * phase;
        spine.rotation.x = 0.95 * Math.max(0, tuck);
        head.rotation.x = 0.7 * Math.max(0, tuck);
        for (let i = 0; i < 2; i++) {
          thighs[i].rotation.x = -1.65 * Math.max(0, tuck);
          knees[i].rotation.x = 2.5 * Math.max(0, tuck);
          shoulders[i].rotation.x = -1.5 * Math.max(0, tuck);
          elbows[i].rotation.x = -1.7 * Math.max(0, tuck);
          ankles[i].rotation.x = -0.15;
        }
        if (ground) groundRoll();
      }
      if (value === 'vault') {
        const k = Math.max(0, Math.min(1, phase / 0.32, (1 - phase) / 0.25));
        const tuck = k * k * (3 - 2 * k);
        // Physics raises the root to beam height. Tuck the hips and feet over the top,
        // leaving the shoulders close enough to the beam for a genuine hand plant.
        hips.position.y = 0.94 - 0.9 * tuck;
        hips.rotation.x = 0.45 * tuck;
        spine.rotation.x = 0.35 * tuck;
        thighs[0].rotation.x = -2.05 * tuck;
        thighs[1].rotation.x = -1.95 * tuck;
        knees[0].rotation.x = 2.7 * tuck;
        knees[1].rotation.x = 2.6 * tuck;
        for (let i = 0; i < 2; i++) {
          shoulders[i].rotation.x = -1.9 * (1 - phase);
          elbows[i].rotation.x = -0.45;
        }
        if (state.handTarget && phase >= 0.3 && phase <= 0.47) {
          for (let i = 0; i < 2; i++) {
            const target = state.handTarget.clone();
            target.x += i === 0 ? -0.18 : 0.18;
            plantArm(i, target);
          }
        }
      }
      if (value === 'wallrun') {
        const side = state.wallSide || 1;
        hips.rotation.z = side * 0.19;
        spine.rotation.x = 0.18;
        shoulders[side > 0 ? 0 : 1].rotation.z = side > 0 ? 0.65 : -0.65;
        shoulders[side > 0 ? 0 : 1].rotation.x = -0.4;
        knees[0].rotation.x += 0.2;
        knees[1].rotation.x += 0.2;
      }
    },
  };
}
