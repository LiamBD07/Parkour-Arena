import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { COURSES, type Course, type GhostFrame } from '../shared/game.js';
import { MOVEMENT as M } from '../shared/movement.js';
import { createRunner, stepRunner, motionPhase, type Input } from '../src/game/physics.js';
import {
  DEFAULT_BINDINGS,
  RunnerControls,
  FixedStepper,
  rebind,
  normalizeBindings,
} from '../src/game/controls.js';
import { makeCharacter } from '../src/game/character.js';
import { validateReplay } from '../server/app.js';
const idle: Input = {
  forward: 0,
  right: 0,
  jump: false,
  sprint: true,
  crouch: false,
  dive: false,
  roll: false,
  flip: false,
  ability: false,
  yaw: 0,
};
const flat: Course = {
  ...COURSES[0],
  start: [0, 0, 0],
  platforms: [{ p: [0, -1, 20], size: [30, 2, 140] }],
  checkpoints: [
    { p: [0, 0, 0], label: 'START' },
    { p: [0, 0, 120], label: 'FINISH' },
  ],
};
function advance(
  s: ReturnType<typeof createRunner>,
  course: Course,
  input: Input,
  seconds: number,
) {
  for (let t = 0; t < seconds; t += M.step) stepRunner(s, input, course, 'runner', M.step);
}
for (const fps of [30, 60, 120, 144, 165, 240, 360])
  test(`a jump tap between render frames is delivered at ${fps} fps`, () => {
    const controls = new RunnerControls(),
      clock = new FixedStepper(),
      s = createRunner(flat);
    controls.down('Space', 0);
    controls.up('Space');
    for (let frame = 1; frame <= Math.ceil(fps * 0.1); frame++)
      clock.advance(1 / fps, (dt) =>
        stepRunner(s, controls.consume((frame * 1000) / fps, 0), flat, 'runner', dt),
      );
    assert.ok(s.p[1] > 0.5, `jump tap must reach physics at ${fps} fps`);
    assert.ok(s.v[1] > 0);
  });
test('a rendering stall cannot expire a queued jump before its first physics tick', () => {
  const controls = new RunnerControls(),
    s = createRunner(flat);
  controls.down('Space', 0);
  controls.up('Space');
  stepRunner(s, controls.consume(600, 0), flat, 'runner', M.step);
  assert.ok(s.v[1] > 9);
  assert.ok(s.p[1] > 0);
  assert.equal(controls.consume(610, 0).jump, false);
});
test('a jump buffered just before landing fires on contact', () => {
  const s = createRunner(flat);
  s.p[1] = 0.22;
  s.v[1] = -3;
  s.grounded = false;
  s.coyote = 0;
  stepRunner(s, { ...idle, jump: true }, flat, 'runner', M.step);
  advance(s, flat, idle, 0.14);
  assert.ok(s.v[1] > 0);
  assert.ok(s.p[1] > 0.2);
});
test('late edge jump succeeds during grace and does not allow endless air jumps', () => {
  const s = createRunner(COURSES[0]);
  s.p = [0, 4, 9.2];
  s.v[2] = 11.8;
  advance(s, COURSES[0], { ...idle, forward: 1 }, 0.09);
  assert.equal(s.grounded, false);
  stepRunner(s, { ...idle, forward: 1, jump: true }, COURSES[0], 'runner', M.step);
  assert.ok(s.v[1] > 9);
  advance(s, COURSES[0], idle, 0.3);
  const before = s.v[1];
  stepRunner(s, { ...idle, jump: true }, COURSES[0], 'runner', M.step);
  assert.ok(s.v[1] < before);
});
test('dive launches forward from standing, then becomes a real ground roll', () => {
  const s = createRunner(flat);
  stepRunner(s, { ...idle, dive: true }, flat, 'runner', M.step);
  assert.equal(String(s.pose), 'dive');
  assert.ok(s.v[1] > 0);
  assert.ok(s.v[2] > 16);
  let rolled = false;
  for (let i = 0; i < 130; i++) {
    stepRunner(s, idle, flat, 'runner', M.step);
    if (s.pose === 'roll') {
      rolled = true;
      assert.equal(s.grounded, true);
    }
  }
  assert.ok(rolled);
  assert.ok(s.p[2] > 8);
});
test('roll is cancelable by jump and never locks out Space', () => {
  const s = createRunner(flat);
  stepRunner(s, { ...idle, roll: true }, flat, 'runner', M.step);
  assert.equal(s.pose, 'roll');
  assert.ok(s.rolling > 0);
  stepRunner(s, { ...idle, jump: true }, flat, 'runner', M.step);
  assert.equal(s.rolling, 0);
  assert.equal(s.pose, 'jump');
  assert.ok(s.v[1] > 9);
});
test('dive cannot be spammed to gain unlimited midair height', () => {
  const s = createRunner(flat);
  stepRunner(s, { ...idle, dive: true }, flat, 'runner', M.step);
  advance(s, flat, idle, 0.6);
  assert.equal(s.grounded, false);
  const vy = s.v[1];
  stepRunner(s, { ...idle, dive: true }, flat, 'runner', M.step);
  assert.ok(s.v[1] < vy);
});
const beamCourse: Course = {
  ...flat,
  platforms: [...flat.platforms, { p: [0, 0.6, 5], size: [6, 1.2, 2], kind: 'obstacle' }],
};
test('one dive press plants a pull vault on a reachable beam and exits faster than jumping', () => {
  const s = createRunner(beamCourse),
    jump = createRunner(beamCourse);
  s.v[2] = jump.v[2] = 11.8;
  stepRunner(s, { ...idle, forward: 1, dive: true }, beamCourse, 'runner', M.step);
  stepRunner(jump, { ...idle, forward: 1, jump: true }, beamCourse, 'runner', M.step);
  assert.equal(s.pose, 'vault');
  assert.ok(s.vault?.contact);
  const duration = s.vault!.duration;
  let cleared = false;
  for (let i = 0; i < Math.ceil(duration / M.step) + 1; i++) {
    stepRunner(s, { ...idle, forward: 1 }, beamCourse, 'runner', M.step);
    stepRunner(jump, { ...idle, forward: 1 }, beamCourse, 'runner', M.step);
    if (s.p[2] > 4 && s.p[2] < 6) {
      assert.ok(s.p[1] >= 1.2);
      cleared = true;
    }
  }
  assert.ok(cleared);
  assert.equal(s.vault, null);
  assert.ok(s.p[2] > 7);
  assert.ok(s.p[2] > jump.p[2]);
  assert.ok(s.v[2] > 15);
});
test('a tall or blocked obstacle cannot be teleported through with vault', () => {
  const course: Course = {
    ...flat,
    platforms: [...flat.platforms, { p: [0, 4, 4], size: [6, 8, 1], kind: 'wall' }],
  };
  const s = createRunner(course);
  stepRunner(s, { ...idle, forward: 1, dive: true }, course, 'runner', M.step);
  assert.equal(s.vault, null);
  advance(s, course, { ...idle, forward: 1 }, 1);
  assert.ok(s.p[2] < 3.5);
});
const wallCourse: Course = {
  ...flat,
  start: [0.84, 5, 0],
  platforms: [{ p: [0, -5, 20], size: [1, 30, 100], kind: 'wall' }],
};
test('wall contact automatically grips, speeds up travel, and steadily loses height', () => {
  const s = createRunner(wallCourse);
  s.grounded = false;
  s.coyote = 0;
  s.v[1] = -8;
  advance(s, wallCourse, { ...idle, forward: 1 }, 0.7);
  assert.equal(s.wallRunning, true);
  assert.equal(s.pose, 'wallrun');
  assert.ok(s.p[1] < 5 && s.p[1] > 3.5);
  assert.ok(s.v[2] > M.sprintSpeed);
  assert.ok(Math.abs(s.p[0] - 0.84) < 0.02);
});
test('wall grip expires and a wall jump detaches rather than instantly regrabbing', () => {
  const s = createRunner(wallCourse);
  s.grounded = false;
  s.coyote = 0;
  advance(s, wallCourse, { ...idle, forward: 1 }, 0.4);
  stepRunner(s, { ...idle, forward: 1, jump: true }, wallCourse, 'runner', M.step);
  assert.equal(s.wallRunning, false);
  assert.ok(s.v[0] > 5);
  assert.ok(s.v[1] > 10);
  assert.ok(s.wallCooldown > 0);
  stepRunner(s, { ...idle, forward: 1 }, wallCourse, 'runner', M.step);
  assert.equal(s.wallRunning, false);
  const hanging = createRunner(wallCourse);
  hanging.grounded = false;
  hanging.coyote = 0;
  advance(hanging, wallCourse, { ...idle, forward: 1 }, 2.2);
  assert.equal(hanging.wallRunning, false);
  assert.ok(hanging.v[1] < -4);
});
test('rebindings persist as a unique map and mouse actions use the same input queue', () => {
  const b = rebind({ ...DEFAULT_BINDINGS }, 'jump', 'KeyE');
  assert.equal(b.jump, 'KeyE');
  assert.equal(b.dive, 'Space');
  assert.deepEqual(normalizeBindings(JSON.parse(JSON.stringify(b))), b);
  const c = new RunnerControls(rebind(b, 'dive', 'Mouse2'));
  c.down('KeyE', 0);
  const first = c.consume(8, 0);
  assert.equal(first.jump, true);
  assert.equal(first.dive, false);
  c.down('Mouse2', 10);
  c.up('Mouse2');
  assert.equal(c.consume(15, 0).dive, true);
  assert.equal(c.consume(20, 0).dive, false);
});
test('arrow aliases cannot secretly conflict with a rebound action', () => {
  const c = new RunnerControls(rebind({ ...DEFAULT_BINDINGS }, 'jump', 'ArrowUp'));
  c.down('ArrowUp', 0);
  const input = c.consume(10, 0);
  assert.equal(input.forward, 0);
  assert.equal(input.jump, true);
});
test('the new rig tucks articulated knees and rotates during a roll without flattening the model', () => {
  const c = makeCharacter('#c7ef5c');
  c.animate(1, 10, 'roll', { phase: 0.25 });
  assert.ok(Math.abs(c.group.getObjectByName('hips')!.rotation.x - Math.PI / 2) < 0.01);
  assert.ok(c.group.getObjectByName('leftKnee')!.rotation.x > 2);
  assert.equal(c.group.scale.y, 1);
  c.animate(1.2, 0, 'idle');
  assert.equal(c.group.getObjectByName('hips')!.rotation.x, 0);
  assert.ok(c.group.getObjectByName('hips')!.position.y > 0.9);
  const size = new THREE.Box3().setFromObject(c.group).getSize(new THREE.Vector3());
  assert.ok(size.y > 1.7 && size.y < 2.1);
  assert.ok(size.x < 1.1);
  c.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const m = Array.isArray(o.material) ? o.material : [o.material];
      m.forEach((v) => v.dispose());
    }
  });
});
test('the entire ground roll stays on the roof without sinking the head or limbs', () => {
  const c = makeCharacter('#c7ef5c');
  for (let i = 0; i <= 20; i++) {
    c.animate(i / 20, 10, 'roll', { phase: i / 20 });
    const bounds = new THREE.Box3().setFromObject(c.group);
    assert.ok(bounds.min.y >= 0.02 && bounds.min.y < 0.035, `floor contact at phase ${i / 20}`);
  }
});
test('both vault hands reach the beam during the plant', () => {
  const c = makeCharacter('#c7ef5c');
  const target = new THREE.Vector3(0, -0.18, 0.47);
  c.animate(1, 12, 'vault', { phase: 0.4, handTarget: target });
  for (const [side, x] of [
    ['left', -0.18],
    ['right', 0.18],
  ] as const) {
    const hand = c.group.getObjectByName(`${side}Hand`)!.getWorldPosition(new THREE.Vector3());
    assert.ok(hand.distanceTo(new THREE.Vector3(x, target.y, target.z)) < 0.03);
  }
});
test('vault, dive and roll replay frames pass the real server validator', () => {
  const course: Course = {
    ...beamCourse,
    checkpoints: [
      { p: [0, 0, 0], label: 'START' },
      { p: [0, 0, 22], label: 'FINISH' },
    ],
  };
  const s = createRunner(course),
    frames: GhostFrame[] = [{ t: 0, p: [...s.p], yaw: 0, pose: 'idle' }];
  for (let i = 1; i <= 1200 && !s.finished; i++) {
    const move = { ...idle, forward: i > 900 ? 1 : 0, dive: i === 1 };
    stepRunner(s, move, course, 'runner', M.step);
    if (i % 12 === 0 || s.finished)
      frames.push({
        t: Math.round(s.time * 1000),
        p: [...s.p],
        yaw: 0,
        pose: s.pose,
        phase: motionPhase(s),
      });
  }
  assert.equal(s.finished, true);
  assert.ok(frames.some((f) => f.pose === 'vault'));
  assert.equal(validateReplay(frames, frames.at(-1)!.t, course), null);
});
