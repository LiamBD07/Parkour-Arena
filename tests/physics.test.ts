import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COURSES,
  courseProgress,
  localRecordKey,
  ratingForRun,
  botDuration,
  type ClassId,
} from '../shared/game.js';
import { createRunner, stepRunner, type Input } from '../shared/physics.js';
import { MOVEMENT as M } from '../shared/movement.js';
import { simulateGuide } from '../shared/guide.js';
import { botReplay, interpolateReplay } from '../shared/replay.js';
import { validateReplay } from '../server/app.js';
const idle: Input = {
  forward: 0,
  right: 0,
  jump: false,
  dive: false,
  roll: false,
  ability: false,
  yaw: 0,
};
test('skill estimates and bot pace follow solo performance with bounded ratings', () => {
  assert.ok(ratingForRun(16000, 24500) > ratingForRun(32000, 24500));
  assert.equal(ratingForRun(1000, 24500), 1800);
  assert.equal(ratingForRun(600000, 24500), 600);
  assert.ok(botDuration(1600) < botDuration(800));
});
for (const course of COURSES) {
  test(`${course.name} is completable with ordinary inputs, uses both walls, and records a valid replay`, () => {
    const result = simulateGuide(course);
    assert.equal(result.state.finished, true);
    assert.equal(result.state.falls, 0);
    assert.equal(result.state.checkpoint, 4);
    assert.deepEqual([...result.wallSections], [0, 1]);
    assert.ok(result.frames.some((f) => f.pose === 'wallrun'));
    assert.ok(result.frames.some((f) => f.pose === 'roll'));
    assert.equal(validateReplay(result.frames, result.frames.at(-1)!.t, course), null);
  });
  for (const section of course.wallSections) {
    test(`${course.name} gap ${section.from + 1} cannot be bypassed with a direct jump, even with class abilities and edge grace`, () => {
      const from = course.platforms[section.from],
        to = course.platforms[section.to];
      const edge = from.p[2] + from.size[2] / 2,
        landing = to.p[2] - to.size[2] / 2;
      assert.ok(landing - edge >= 22);
      for (const classId of ['runner', 'acrobat', 'traceur'] as ClassId[])
        for (const abilityAt of [0, 0.2, 0.4, 0.6, 0.8, 0.95]) {
          const s = createRunner(course);
          s.p = [from.p[0], from.p[1] + from.size[1] / 2, edge + 0.2];
          s.v[2] = M.runSpeed;
          for (let i = 0; i < 14; i++)
            stepRunner(
              s,
              { ...idle, forward: 1, ability: classId === 'runner' && i === 0 },
              course,
              classId,
              M.step,
            );
          stepRunner(s, { ...idle, forward: 1, jump: true }, course, classId, M.step);
          let landed = false;
          for (let i = 0; i < 360 && !s.falls; i++) {
            stepRunner(
              s,
              {
                ...idle,
                forward: 1,
                ability: classId !== 'runner' && i === Math.round(abilityAt / M.step),
              },
              course,
              classId,
              M.step,
            );
            if (s.p[2] >= landing - 0.28 && s.grounded && s.p[1] >= to.p[1] + to.size[1] / 2 - 0.1)
              landed = true;
          }
          assert.equal(landed, false, `${classId}, ability ${abilityAt}s must still need the wall`);
        }
    });
  }
  test(`${course.name}'s synthetic ghost follows the wall route and has valid frame timing`, () => {
    const frames = botReplay(course, 32000);
    assert.equal(validateReplay(frames, 32000, course), null);
    assert.ok(frames.some((f) => f.pose === 'wallrun'));
    assert.ok(frames.some((f) => f.pose === 'roll'));
    const middle = interpolateReplay(frames, 16050)!;
    assert.ok(
      courseProgress(course, middle.p[2]) > 0.2 && courseProgress(course, middle.p[2]) < 0.8,
    );
    const bad = structuredClone(frames);
    bad[10].p[2] += 80;
    assert.match(validateReplay(bad, 32000, course)!, /movement limit/);
  });
}
test('progress, finish and local personal best keys follow the course layout version', () => {
  const c = COURSES[0];
  assert.equal(courseProgress(c, c.start[2]), 0);
  assert.equal(courseProgress(c, c.checkpoints.at(-1)!.p[2]), 1);
  assert.notEqual(localRecordKey(c), localRecordKey({ ...c, version: c.version - 1 }));
});
test('a hinged roof drops after standing on it', () => {
  const c = COURSES[0],
    s = createRunner(c),
    p = c.platforms.find((p) => p.kind === 'hinge')!;
  s.p = [p.p[0], p.p[1] + p.size[1] / 2, p.p[2]];
  for (let i = 0; i < 200; i++) stepRunner(s, idle, c, 'runner', M.step);
  assert.ok(Object.keys(s.hinges).length);
  assert.ok(s.p[1] < 4);
});
test('fall recovery resets maneuvers and keeps the last checkpoint and run clock', () => {
  const c = COURSES[0],
    s = createRunner(c);
  s.checkpoint = 2;
  s.p = [40, -12.9, 90];
  s.v[1] = -20;
  s.grounded = false;
  s.trickActive = true;
  s.diving = true;
  s.rolling = 0.4;
  stepRunner(s, idle, c, 'runner', 0.02);
  assert.deepEqual(s.p, c.checkpoints[2].p);
  assert.equal(s.falls, 1);
  assert.equal(s.diving, false);
  assert.equal(s.trickActive, false);
  assert.equal(s.rolling, 0);
  assert.ok(s.time > 0);
});
test('Acrobat air step grants lift once and respects its cooldown', () => {
  const c = COURSES[0],
    s = createRunner(c);
  s.grounded = false;
  s.p = [0, 7, 0];
  s.v[1] = -2;
  stepRunner(s, { ...idle, ability: true }, c, 'acrobat', M.step);
  assert.ok(s.v[1] > 8);
  assert.ok(s.cooldown > 13);
  s.v[1] = -2;
  stepRunner(s, { ...idle, ability: true }, c, 'acrobat', M.step);
  assert.ok(s.v[1] < 0);
});
