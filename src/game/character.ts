import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Pose } from '../../shared/game';

export interface Character {
  group: THREE.Group;
  animate: (t: number, speed: number, pose: Pose) => void;
}
export function makeCharacter(color: string, ghost = false): Character {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: ghost ? color : '#252d31',
    roughness: 0.78,
    metalness: 0.2,
    transparent: ghost,
    opacity: ghost ? 0.4 : 1,
  });
  const armor = new THREE.MeshStandardMaterial({
    color: ghost ? color : '#414e52',
    roughness: 0.5,
    metalness: 0.5,
    transparent: ghost,
    opacity: ghost ? 0.45 : 1,
  });
  const trim = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: ghost ? 0.9 : 0.35,
    roughness: 0.4,
    transparent: ghost,
    opacity: ghost ? 0.65 : 1,
  });
  const visor = new THREE.MeshStandardMaterial({
    color: '#111c20',
    metalness: 0.9,
    roughness: 0.13,
    emissive: color,
    emissiveIntensity: 0.15,
  });
  const box = (
    size: number[],
    pos: number[],
    material: THREE.Material,
    parent: THREE.Object3D = group,
  ) => {
    const [w, h, d] = size;
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(0.035, w / 6, h / 6, d / 6)),
      material,
    );
    mesh.position.set(...(pos as [number, number, number]));
    mesh.castShadow = !ghost;
    mesh.receiveShadow = !ghost;
    parent.add(mesh);
    return mesh;
  };
  const torso = new THREE.Group();
  torso.position.y = 1.15;
  group.add(torso);
  box([0.62, 0.64, 0.32], [0, 0.02, 0], suit, torso);
  box([0.67, 0.35, 0.1], [0, 0.17, 0.2], armor, torso);
  box([0.48, 0.06, 0.025], [0, 0.27, 0.258], trim, torso);
  box([0.1, 0.5, 0.36], [-0.23, 0.02, 0], armor, torso);
  box([0.1, 0.5, 0.36], [0.23, 0.02, 0], armor, torso);
  box([0.36, 0.08, 0.04], [0, -0.18, 0.19], trim, torso);
  box([0.46, 0.18, 0.32], [0, -0.39, 0], armor, torso);
  const head = new THREE.Group();
  head.position.set(0, 0.58, 0.025);
  torso.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.245, 20, 16), armor);
  helmet.scale.set(1, 1.1, 0.92);
  head.add(helmet);
  helmet.castShadow = !ghost;
  box([0.38, 0.11, 0.13], [0, 0.015, 0.19], visor, head);
  box([0.3, 0.023, 0.015], [0, 0.026, 0.265], trim, head);
  box([0.065, 0.34, 0.33], [0, 0.07, 0], suit, head);
  const arms: THREE.Group[] = [],
    legs: THREE.Group[] = [];
  for (const sign of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sign * 0.39, 0.22, 0);
    torso.add(arm);
    arms.push(arm);
    box([0.22, 0.27, 0.25], [0, -0.08, 0], armor, arm);
    box([0.15, 0.25, 0.17], [0, -0.31, 0.02], suit, arm);
    box([0.19, 0.24, 0.22], [0, -0.49, 0.085], armor, arm);
    box([0.21, 0.035, 0.235], [0, -0.4, 0.085], trim, arm);
    box([0.14, 0.16, 0.15], [0, -0.66, 0.12], suit, arm);
    const leg = new THREE.Group();
    leg.position.set(sign * 0.19, 0.8, 0);
    group.add(leg);
    legs.push(leg);
    box([0.24, 0.34, 0.25], [0, -0.13, 0], suit, leg);
    box([0.27, 0.16, 0.1], [0, -0.36, 0.13], armor, leg);
    box([0.18, 0.3, 0.2], [0, -0.53, 0], suit, leg);
    box([0.22, 0.07, 0.24], [0, -0.46, 0], trim, leg);
    box([0.26, 0.14, 0.39], [0, -0.73, 0.08], armor, leg);
  }
  return {
    group,
    animate: (t, speed, pose) => {
      const moving = Math.min(1, speed / 7);
      const swing = Math.sin(t * 12) * 0.75 * moving;
      arms[0].rotation.x = swing;
      arms[1].rotation.x = -swing;
      legs[0].rotation.x = -swing;
      legs[1].rotation.x = swing;
      torso.rotation.x = pose === 'slide' || pose === 'dive' ? 1.05 : moving * 0.13;
      torso.rotation.z = Math.sin(t * 6) * 0.025;
      group.scale.y = group.scale.x * (pose === 'slide' ? 0.55 : 1);
      group.rotation.x = pose === 'flip' ? -t * 9 : 0;
      if (pose === 'dive') {
        arms[0].rotation.x = -2;
        arms[1].rotation.x = -2;
      }
      if (pose === 'idle') {
        arms[0].rotation.x = -0.12;
        arms[1].rotation.x = 0.15;
        head.rotation.y = Math.sin(t * 0.35) * 0.18;
      }
    },
  };
}
