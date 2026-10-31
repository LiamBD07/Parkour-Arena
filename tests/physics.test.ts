import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURSES, ratingForRun, botDuration, type GhostFrame } from '../shared/game.js';
import { createRunner, stepRunner, type Input } from '../src/game/physics.js';
import { botReplay, interpolateReplay } from '../shared/replay.js';
import { validateReplay } from '../server/app.js';
const course = COURSES[0];
const input: Input = {
  forward: 0,
  right: 0,
  sprint: false,
  crouch: false,
  jump: false,
  flip: false,
  dive: false,
  ability: false,
  yaw: 0,
};
test('skill estimates and bot pace reflect solo performance without unbounded ratings', () => {
  assert.ok(ratingForRun(16000, 24500) > ratingForRun(32000, 24500));
  assert.equal(ratingForRun(1000, 24500), 1800);
  assert.equal(ratingForRun(600000, 24500), 600);
  assert.ok(botDuration(1600) < botDuration(800));
});
test('sprinting and a timed jump cross the first rooftop gap', () => {
  const state = createRunner(course);
  let jumped = false,
    landed = false;
  for (let i = 0; i < 330; i++) {
    const jump = state.p[2] > 6 && !jumped;
    if (jump) jumped = true;
    stepRunner(state, { ...input, forward: 1, sprint: true, jump }, course, 'runner', 1 / 120);
    if (jumped && state.p[2] > 15 && state.grounded) {
      landed = true;
      break;
    }
  }
  assert.equal(jumped, true);
  assert.equal(landed, true);
  assert.equal(state.falls, 0);
});
test('a single roll clears a low beam that stops a standing runner', () => {
  const standing = createRunner(course),
    sliding = createRunner(course);
  standing.p = [-5, 5, 42];
  sliding.p = [-5, 5, 42];
  standing.v[2] = sliding.v[2] = 11.8;
  for (let i = 0; i < 150; i++) {
    stepRunner(standing, { ...input, forward: 1 }, course, 'runner', 1 / 120);
    stepRunner(
      sliding,
      { ...input, forward: 1, roll: i === 0, sprint: true },
      course,
      'runner',
      1 / 120,
    );
  }
  assert.ok(standing.p[2] < 46);
  assert.ok(sliding.p[2] > 49);
});
test('a completed flip boosts a landing; a late flip causes a brief recovery', () => {
  const clean = createRunner(course),
    late = createRunner(course);
  for (let i = 0; i < 105; i++) {
    stepRunner(clean, { ...input, jump: i === 0, flip: i === 0 }, course, 'runner', 1 / 120);
    stepRunner(late, { ...input, jump: i === 0, flip: i === 95 }, course, 'runner', 1 / 120);
  }
  assert.ok(clean.boost > 0);
  assert.equal(clean.recovery, 0);
  assert.ok(late.recovery > 0);
  assert.equal(late.boost, 0);
});
test('air step grants lift once and respects its cooldown', () => {
  const state = createRunner(course);
  state.grounded = false;
  state.p[1] = 7;
  state.v[1] = -2;
  stepRunner(state, { ...input, ability: true }, course, 'acrobat', 1 / 120);
  assert.ok(state.v[1] > 8);
  assert.ok(state.cooldown > 13);
  state.v[1] = -2;
  stepRunner(state, { ...input, ability: true }, course, 'acrobat', 1 / 120);
  assert.ok(state.v[1] < 0);
});
test('a hinged platform drops under the runner', () => {
  const state = createRunner(course);
  state.p = [5, 6, 106];
  for (let i = 0; i < 200; i++) stepRunner(state, input, course, 'runner', 1 / 120);
  assert.ok(Object.keys(state.hinges).length > 0);
  assert.ok(state.p[1] < 4);
});
test('falling recovers at the last reached checkpoint', () => {
  const state = createRunner(course);
  state.checkpoint = 2;
  state.p = [40, -12.9, 90];
  state.v[1] = -20;
  state.grounded = false;
  stepRunner(state, input, course, 'runner', 0.02);
  assert.deepEqual(state.p, course.checkpoints[2].p);
  assert.equal(state.falls, 1);
});
test('wall running limits descent on grip walls only', () => {
  const state = createRunner(course);
  state.p = [-6.6, 7, 19];
  state.grounded = false;
  state.v[1] = -9;
  stepRunner(state, { ...input, forward: 1 }, course, 'traceur', 1 / 120);
  assert.equal(state.wallRunning, true);
  assert.ok(state.v[1] >= -1.3);
});
test('replay interpolation and all practice routes cover the intended course', () => {
  for (const course of COURSES) {
    const frames = botReplay(course, 32000);
    assert.equal(validateReplay(frames, 32000, course), null);
    const middle = interpolateReplay(frames, 16050)!;
    assert.ok(middle.p[2] > 70 && middle.p[2] < 80);
    const bad = structuredClone(frames);
    bad[10].p[2] += 80;
    assert.match(validateReplay(bad, 32000, course)!, /movement limit/);
  }
});

test('every complete course is traversable without class abilities and produces a valid recorded run', () => {
  for (const course of COURSES) {
    const state = createRunner(course);
    const roofs = course.platforms.filter((p) => !p.kind || p.kind === 'hinge');
    const frames: GhostFrame[] = [];
    // A test driver only chooses ordinary controls: steer around boxes, tap roll under beams,
    // and jump shortly before each roof edge. It does not set positions or velocities.
    for (let tick = 0; tick < 3600 && !state.finished; tick++) {
      const z = state.p[2];
      let index = roofs.findIndex(
        (p) => z >= p.p[2] - p.size[2] / 2 - 0.1 && z <= p.p[2] + p.size[2] / 2 + 0.1,
      );
      if (index < 0) index = Math.max(0, roofs.findIndex((p) => p.p[2] > z) - 1);
      const roof = roofs[index],
        next = roofs[Math.min(index + 1, roofs.length - 1)];
      const blend = Math.max(0, Math.min(1, (z - (roof.p[2] + roof.size[2] / 2 - 7)) / 12));
      let targetX = roof.p[0] + (next.p[0] - roof.p[0]) * blend;
      const lowBeam = course.platforms.find(
        (p) =>
          p.kind === 'obstacle' &&
          p.p[1] - p.size[1] / 2 > roof.p[1] + roof.size[1] / 2 + 0.2 &&
          Math.abs(z - p.p[2]) < 8,
      );
      const box = course.platforms.find(
        (p) =>
          p.kind === 'obstacle' &&
          p.p[1] - p.size[1] / 2 <= roof.p[1] + roof.size[1] / 2 + 0.2 &&
          z < p.p[2] + p.size[2] / 2 + 1 &&
          z > p.p[2] - 8,
      );
      if (box) targetX = box.p[0] + (next.p[0] < box.p[0] ? -1 : 1) * (box.size[0] / 2 + 1);
      const jump =
        state.grounded && z > roof.p[2] + roof.size[2] / 2 - 1.3 && index < roofs.length - 1;
      const roll =
        !!lowBeam &&
        lowBeam.p[2] - z > 0 &&
        lowBeam.p[2] - z < 5.8 &&
        state.rolling <= 0 &&
        state.maneuverCooldown <= 0;
      stepRunner(
        state,
        {
          ...input,
          forward: 1,
          right: -Math.max(-1, Math.min(1, (targetX - state.p[0]) * 0.7)),
          jump,
          sprint: true,
          roll,
        },
        course,
        'runner',
        1 / 120,
      );
      if (tick % 12 === 0)
        frames.push({
          t: Math.round((tick / 120) * 1000),
          p: [...state.p],
          yaw: 0,
          pose: state.pose,
        });
    }
    const time = Math.round(state.time * 1000);
    frames.push({ t: time, p: [...state.p], yaw: 0, pose: state.pose });
    assert.equal(state.finished, true, `${course.name} must be completable`);
    assert.equal(state.falls, 0, `${course.name} must not require a fall recovery`);
    assert.equal(state.checkpoint, 4);
    assert.equal(
      validateReplay(frames, time, course),
      null,
      `${course.name}'s real physics replay must be valid`,
    );
  }
});
