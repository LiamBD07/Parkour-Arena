import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { COURSES, type Course } from '../shared/game.js';
import { MOVEMENT as M, TRICKS } from '../shared/movement.js';
import {
  createRunner,
  stepRunner,
  motionPhase,
  beamProgress,
  type Input,
} from '../shared/physics.js';
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  RunnerControls,
  FixedStepper,
  rebind,
  normalizeBindings,
  migrateBindings,
} from '../src/game/controls.js';
import { makeCharacter } from '../src/game/character.js';
const idle: Input = {
  forward: 0,
  right: 0,
  jump: false,
  dive: false,
  roll: false,
  ability: false,
  yaw: 0,
};
const flat: Course = {
  ...COURSES[0],
  start: [0, 0, 0],
  wallSections: [],
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
  random = () => 0,
) {
  for (let t = 0; t < seconds; t += M.step) stepRunner(s, input, course, 'runner', M.step, random);
}
for (const fps of [30, 60, 120, 144, 165, 240, 360])
  test(`a jump tap survives render-only frames at ${fps} fps`, () => {
    const c = new RunnerControls(),
      clock = new FixedStepper(),
      s = createRunner(flat);
    c.down('Space', 0);
    c.up('Space');
    for (let frame = 1; frame <= Math.ceil(fps * 0.1); frame++)
      clock.advance(1 / fps, (dt) =>
        stepRunner(s, c.consume((frame * 1000) / fps, 0), flat, 'runner', dt),
      );
    assert.ok(s.p[1] > 0.5);
    assert.ok(s.v[1] > 0);
  });
test('a slow rendering frame cannot expire a queued jump', () => {
  const c = new RunnerControls(),
    s = createRunner(flat);
  c.down('Space', 0);
  c.up('Space');
  stepRunner(s, c.consume(600, 0), flat, 'runner', M.step);
  assert.ok(s.v[1] > 9);
  assert.equal(c.consume(610, 0).jump, false);
});
test('a landing-buffered jump from a fall fires on roof contact', () => {
  const s = createRunner(flat);
  s.p[1] = 0.22;
  s.v[1] = -3;
  s.grounded = false;
  s.coyote = 0;
  stepRunner(s, { ...idle, jump: true }, flat, 'runner', M.step);
  advance(s, flat, idle, 0.14);
  assert.ok(s.p[1] > 0.2);
  assert.ok(s.v[1] > 0);
});
test('edge grace permits a late jump but not a second jump in the air', () => {
  const course = {
    ...flat,
    platforms: [
      { p: [0, -1, 0] as [number, number, number], size: [20, 2, 6] as [number, number, number] },
    ],
  };
  const s = createRunner(course);
  s.p[2] = 3.2;
  s.v[2] = M.runSpeed;
  advance(s, course, { ...idle, forward: 1 }, 0.09);
  stepRunner(s, { ...idle, forward: 1, jump: true }, course, 'runner', M.step);
  assert.ok(s.v[1] > 9);
  advance(s, course, idle, 0.2);
  const before = s.v[1];
  stepRunner(s, { ...idle, jump: true }, course, 'runner', M.step);
  assert.ok(s.v[1] < before);
  assert.ok(s.trickActive);
});
test('Space in the open is an ordinary jump with no floor-dive crash', () => {
  const s = createRunner(flat);
  stepRunner(s, { ...idle, forward: 1, jump: true }, flat, 'runner', M.step);
  assert.equal(s.pose, 'jump');
  advance(s, flat, { ...idle, forward: 1 }, 1);
  assert.equal(s.crashTime, 0);
  assert.equal(s.diving, false);
});
const beamCourse: Course = {
  ...flat,
  platforms: [...flat.platforms, { p: [0, 0.6, 5], size: [6, 1.2, 2], kind: 'obstacle' }],
};
test('Space beside a low beam jumps, and a second Space performs a trick instead of diving', () => {
  const s = createRunner(beamCourse);
  s.p[2] = 1.5;
  stepRunner(s, { ...idle, forward: 1, jump: true }, beamCourse, 'runner', M.step);
  assert.equal(s.pose, 'jump');
  assert.equal(s.diving, false);
  advance(s, beamCourse, { ...idle, forward: 1 }, 0.15);
  stepRunner(s, { ...idle, forward: 1, jump: true }, beamCourse, 'runner', M.step, () => 0.6);
  assert.equal(s.pose, 'spin');
  assert.equal(s.diving, false);
});
test('E beside a roof-supported beam plants hands and pulls faster than running throughout the vault', () => {
  const s = createRunner(beamCourse);
  s.p[2] = 1.5;
  s.v[2] = M.runSpeed;
  stepRunner(s, { ...idle, forward: 1, dive: true }, beamCourse, 'runner', M.step);
  assert.equal(s.pose, 'dive');
  let planted = false,
    boosted = false;
  for (let i = 0; i < 150; i++) {
    const previousVault = s.vault;
    const previousZ = s.p[2];
    stepRunner(s, { ...idle, forward: 1 }, beamCourse, 'runner', M.step);
    if (s.vault) {
      planted = true;
      assert.ok(s.vault.start[2] >= 5);
      assert.equal(s.crashTime, 0);
      assert.ok(Math.abs(s.v[2] - M.vaultSpeed) < 1e-6);
      if (previousVault) assert.ok(Math.abs((s.p[2] - previousZ) / M.step - M.vaultSpeed) < 1e-6);
    }
    if (s.boost > 0) boosted = true;
  }
  assert.ok(planted);
  assert.ok(boosted);
  assert.ok(s.p[2] > 7);
  assert.ok(s.v[2] > M.runSpeed);
  assert.equal(s.crashTime, 0);
});
test('E alone beside a beam completes the dive and pull without holding a movement key', () => {
  const s = createRunner(beamCourse);
  s.p[2] = 1.5;
  stepRunner(s, { ...idle, dive: true }, beamCourse, 'runner', M.step);
  let pulled = false;
  for (let i = 0; i < 120; i++) {
    stepRunner(s, idle, beamCourse, 'runner', M.step);
    if (s.vault) pulled = true;
  }
  assert.ok(pulled);
  assert.equal(s.crashTime, 0);
  assert.ok(s.p[2] > 7);
});
test('an airborne E dive reaches the beam, pulls, and keeps a sustained speed boost after landing', () => {
  const s = createRunner(beamCourse);
  s.v[2] = M.runSpeed;
  stepRunner(s, { ...idle, forward: 1, jump: true }, beamCourse, 'runner', M.step);
  advance(s, beamCourse, { ...idle, forward: 1 }, 0.25);
  const vy = s.v[1];
  stepRunner(s, { ...idle, forward: 1, dive: true }, beamCourse, 'runner', M.step);
  assert.equal(s.diving, true);
  assert.ok(s.v[1] < vy);
  let pulled = false;
  for (let i = 0; i < 120; i++) {
    stepRunner(s, { ...idle, forward: 1 }, beamCourse, 'runner', M.step);
    if (s.vault) pulled = true;
    if (pulled && !s.vault) break;
  }
  assert.ok(pulled && s.grounded);
  assert.ok(s.v[2] >= M.vaultSpeed);
  advance(s, beamCourse, { ...idle, forward: 1 }, 0.55);
  assert.ok(s.boost > 0);
  assert.ok(s.v[2] > M.runSpeed * 1.4);
  assert.equal(s.crashTime, 0);
});
for (const course of COURSES)
  for (const index of [12, 13])
    test(`${course.name} beam ${index}: a visible hand landing pulls across instead of crashing on the floor`, () => {
      const beam = course.platforms[index],
        top = beam.p[1] + beam.size[1] / 2,
        s = createRunner(course);
      s.p = [beam.p[0], 5, beam.p[2] - 7];
      s.v[2] = M.runSpeed;
      stepRunner(s, { ...idle, forward: 1, dive: true }, course, 'runner', M.step);
      for (let i = 0; i < 160 && !s.vault && !s.crashTime; i++)
        stepRunner(s, { ...idle, forward: 1 }, course, 'runner', M.step);
      assert.ok(s.vault, 'hands on the beam must trigger the arm pull');
      assert.ok(
        s.vault.start[1] < top,
        'the feet remain below the beam while the hands land on it',
      );
      assert.ok(beamProgress(s.vault.contact, s.drive, beam) >= 0.25);
      assert.equal(s.crashTime, 0);
      assert.equal(s.v[2], M.vaultSpeed);
      assert.ok(s.boost > 0);
      for (let i = 0; i < 120 && s.vault; i++)
        stepRunner(s, { ...idle, forward: 1 }, course, 'runner', M.step);
      assert.ok(s.grounded);
      assert.ok(s.p[2] > beam.p[2] + beam.size[2] / 2);
      assert.equal(s.crashTime, 0);
      assert.equal(s.v[2], M.vaultSpeed);
    });
test('a dive landing on a higher roof uses the floor beneath that beam, not the takeoff roof', () => {
  const course: Course = {
    ...flat,
    platforms: [
      { p: [0, 3, -6], size: [30, 2, 8] },
      { p: [0, 4, 10], size: [30, 2, 16] },
      { p: [0, 5.6, 5], size: [6, 1.2, 2], kind: 'obstacle' },
    ],
  };
  const s = createRunner(course);
  s.p = [0, 9, -0.25];
  s.v = [0, -1, M.runSpeed];
  s.grounded = false;
  s.coyote = 0;
  s.diveFloor = 4;
  stepRunner(s, { ...idle, forward: 1, dive: true }, course, 'runner', M.step);
  assert.equal(s.diveObstacle, null, 'the beam is outside assisted-dive reach at takeoff');
  assert.equal(s.diveFloor, 4);
  for (let i = 0; i < 160 && !s.vault && !s.crashTime; i++)
    stepRunner(s, { ...idle, forward: 1 }, course, 'runner', M.step);
  assert.ok(s.vault);
  assert.equal(s.diveFloor, 5);
  assert.equal(s.crashTime, 0);
  assert.equal(s.v[2], M.vaultSpeed);
  assert.ok(s.boost > 0);
});
test('reaching only the front of a deep beam with the hands does not bypass the quarter cutoff', () => {
  const course: Course = {
    ...flat,
    platforms: [flat.platforms[0], { p: [0, 0.6, 5], size: [6, 1.2, 4], kind: 'obstacle' }],
  };
  const s = createRunner(course);
  s.p[2] = -3;
  s.v[2] = M.runSpeed;
  stepRunner(s, { ...idle, forward: 1, dive: true }, course, 'runner', M.step);
  for (let i = 0; i < 160 && !s.crashTime; i++) {
    stepRunner(s, { ...idle, forward: 1 }, course, 'runner', M.step);
    assert.equal(s.vault, null);
    assert.equal(s.boost, 0);
  }
  assert.ok(s.crashTime > 0);
});
test('landing between the first quarter and midpoint grants the hand pull and boost', () => {
  const s = createRunner(beamCourse);
  s.p[2] = 1.5;
  s.v[2] = M.runSpeed;
  stepRunner(s, { ...idle, forward: 1, dive: true }, beamCourse, 'runner', M.step);
  for (let i = 0; i < 120 && !s.vault && !s.crashTime; i++)
    stepRunner(s, { ...idle, forward: i >= 24 ? -1 : 1 }, beamCourse, 'runner', M.step);
  assert.ok(s.vault);
  const progress = beamProgress(s.vault.start, s.drive, beamCourse.platforms[1]);
  assert.ok(progress >= 0.25 && progress < 0.5);
  assert.ok(s.boost > 0);
  assert.equal(s.v[2], M.vaultSpeed);
  assert.equal(s.crashTime, 0);
});
test('the first-quarter cutoff follows forward, backward, sideways and diagonal approaches', () => {
  const beam = beamCourse.platforms[1];
  for (const [point, direction] of [
    [
      [0, 1.2, 4.5],
      [0, 1],
    ],
    [
      [0, 1.2, 5.5],
      [0, -1],
    ],
    [
      [-1.5, 1.2, 5],
      [1, 0],
    ],
    [
      [1.5, 1.2, 5],
      [-1, 0],
    ],
    [
      [-0.5, 1.2, 4.5],
      [Math.SQRT1_2, Math.SQRT1_2],
    ],
  ] as const)
    assert.ok(Math.abs(beamProgress([...point], [...direction], beam) - 0.25) < 1e-8);
});
test('a dive landing exactly one quarter across gets the boost; just before it gets a penalty', () => {
  for (const landingZ of [4.499, 4.5, 4.501]) {
    const s = createRunner(beamCourse);
    s.p = [0, 1.20001, landingZ - M.runSpeed * M.step];
    s.v = [0, -4, M.runSpeed];
    s.grounded = false;
    s.coyote = 0;
    stepRunner(s, { ...idle, forward: 1, dive: true }, beamCourse, 'runner', M.step);
    assert.ok(Math.abs(s.p[2] - landingZ) < 1e-6);
    assert.equal(!!s.vault, landingZ >= 4.5);
    assert.equal(s.boost > 0, landingZ >= 4.5);
    assert.equal(s.crashTime > 0, landingZ < 4.5);
  }
});
test('landing a beam dive before its first quarter loses momentum', () => {
  const s = createRunner(beamCourse);
  s.p[2] = 1.5;
  s.v[2] = M.runSpeed;
  stepRunner(s, { ...idle, forward: 1, dive: true }, beamCourse, 'runner', M.step);
  for (let i = 0; i < 150 && !s.crashTime; i++)
    stepRunner(s, { ...idle, forward: -1 }, beamCourse, 'runner', M.step);
  assert.ok(s.crashTime > 0);
  assert.ok(s.p[2] < 4.5);
  assert.equal(s.p[1], 1.2);
  assert.equal(s.vault, null);
  assert.equal(s.boost, 0);
});
test('a dive that misses a thin beam and hits the floor crashes', () => {
  const course: Course = {
    ...beamCourse,
    platforms: [flat.platforms[0], { p: [0, 0.6, 5], size: [0.25, 1.2, 2], kind: 'obstacle' }],
  };
  const s = createRunner(course);
  s.p[2] = 0.5;
  s.v[2] = M.runSpeed;
  stepRunner(s, { ...idle, forward: 1, dive: true }, course, 'runner', M.step);
  for (let i = 0; i < 180 && !s.crashTime; i++)
    stepRunner(s, { ...idle, right: 1 }, course, 'runner', M.step);
  assert.ok(s.crashTime > 0);
  assert.equal(s.p[1], 0);
  assert.equal(s.vault, null);
  assert.equal(s.boost, 0);
});
const elevated: Course = {
  ...flat,
  platforms: [flat.platforms[0], { p: [0, 2.1, 5], size: [12, 0.7, 2.6], kind: 'obstacle' }],
};
test('an elevated beam can never be an E dive target or grant a pull boost, even from above', () => {
  for (const height of [0, 3.5]) {
    const s = createRunner(elevated);
    s.p = [0, height, 1.5];
    s.grounded = height === 0;
    s.coyote = height === 0 ? M.coyote : 0;
    s.v[2] = M.runSpeed;
    stepRunner(s, { ...idle, forward: 1, dive: true }, elevated, 'runner', M.step);
    assert.equal(s.diveObstacle, null);
    for (let i = 0; i < 180 && !s.crashTime; i++) {
      stepRunner(s, { ...idle, forward: 1 }, elevated, 'runner', M.step);
      assert.equal(s.vault, null);
      assert.equal(s.boost, 0);
    }
    assert.ok(s.crashTime > 0);
    assert.equal(s.vault, null);
  }
});
test('E in the open crashes on the floor and repeated E cannot add lift', () => {
  const s = createRunner(flat);
  stepRunner(s, { ...idle, forward: 1, dive: true }, flat, 'runner', M.step);
  const vy = s.v[1];
  stepRunner(s, { ...idle, forward: 1, dive: true }, flat, 'runner', M.step);
  assert.ok(s.v[1] < vy);
  for (let i = 0; i < 120 && !s.crashTime; i++)
    stepRunner(s, { ...idle, forward: 1 }, flat, 'runner', M.step);
  assert.ok(s.crashTime > 0);
  assert.ok(s.v[2] < M.walkSpeed);
  assert.equal(s.boost, 0);
});
const landingBeam: Course = {
  ...flat,
  platforms: [flat.platforms[0], { p: [0, 2.1, 11.2], size: [12, 0.7, 2.6], kind: 'obstacle' }],
};
for (const pressAt of [0.66, 0.75, 0.8])
  test(`Shift pressed at ${pressAt}s into a jump starts a full roll on landing under the beam`, () => {
    const s = createRunner(landingBeam);
    s.v[2] = M.runSpeed;
    stepRunner(s, { ...idle, forward: 1, jump: true }, landingBeam, 'runner', M.step);
    let prepared = false,
      landed = false;
    for (let i = 1; i <= 150; i++) {
      const wasGrounded = s.grounded;
      stepRunner(
        s,
        { ...idle, forward: 1, roll: i === Math.round(pressAt / M.step) },
        landingBeam,
        'runner',
        M.step,
      );
      if (!s.grounded) {
        assert.equal(s.rolling, 0, 'the roll duration must not be spent in the air');
        if (s.rollReady) {
          prepared = true;
          assert.equal(s.pose, 'roll-ready');
        }
      } else if (!wasGrounded) {
        landed = true;
        assert.equal(s.pose, 'roll');
        assert.equal(s.rolling, M.rollDuration);
        assert.equal(s.rollBuffer, 0);
        assert.ok(s.rollUnderBeam);
      }
      assert.ok(Math.abs(s.v[2] - M.runSpeed) < 1e-6, 'no collision or roll speed loss');
    }
    assert.ok(prepared && landed);
    assert.ok(s.p[2] > 12.8, 'the runner passes the beam at entry speed');
  });
test('Shift pressed too early expires instead of rolling later without another press', () => {
  const s = createRunner(flat);
  stepRunner(s, { ...idle, forward: 1, jump: true }, flat, 'runner', M.step);
  for (let i = 1; i <= 150; i++) {
    stepRunner(s, { ...idle, forward: 1, roll: i === 36 }, flat, 'runner', M.step);
    assert.equal(s.rolling, 0);
    assert.equal(s.rollReady, false);
  }
  assert.equal(s.rollBuffer, 0);
  assert.ok(s.grounded);
});
test('a queued landing roll retains the penalty from a late trick', () => {
  const s = createRunner(landingBeam);
  s.v[2] = M.runSpeed;
  stepRunner(s, { ...idle, forward: 1, jump: true }, landingBeam, 'runner', M.step);
  advance(s, landingBeam, { ...idle, forward: 1 }, 0.7);
  stepRunner(s, { ...idle, forward: 1, jump: true, roll: true }, landingBeam, 'runner', M.step);
  for (let i = 0; i < 60 && !s.grounded; i++)
    stepRunner(s, { ...idle, forward: 1 }, landingBeam, 'runner', M.step);
  assert.ok(s.grounded);
  assert.equal(s.pose, 'roll');
  assert.ok(s.recovery > 0);
  assert.ok(s.v[2] < M.runSpeed * 0.75);
  assert.equal(s.boost, 0);
});
test('a random roll slows to walking and cannot propel a standing runner', () => {
  const s = createRunner(flat);
  s.v[2] = M.runSpeed;
  stepRunner(s, { ...idle, forward: 1, roll: true }, flat, 'runner', M.step);
  advance(s, flat, { ...idle, forward: 1 }, 0.5);
  assert.equal(s.pose, 'roll');
  assert.ok(s.v[2] <= M.walkSpeed + 0.001);
  advance(s, flat, { ...idle, forward: 1 }, 0.4);
  assert.ok(s.v[2] > M.walkSpeed + 3);
  const still = createRunner(flat);
  stepRunner(still, { ...idle, roll: true }, flat, 'runner', M.step);
  advance(still, flat, idle, 1);
  assert.equal(still.p[2], 0);
});
test('holding Shift plays just one roll and never repeats it', () => {
  const c = new RunnerControls(),
    s = createRunner(flat);
  c.down('ShiftLeft', 0);
  let rolls = 0,
    wasRolling = false;
  for (let i = 0; i < 240; i++) {
    c.down('ShiftLeft', i * 8, true);
    stepRunner(s, c.consume(i * 8, 0), flat, 'runner', M.step);
    if (s.rolling > 0 && !wasRolling) rolls++;
    wasRolling = s.rolling > 0;
  }
  assert.equal(rolls, 1);
  assert.equal(s.rolling, 0);
});
for (const course of COURSES)
  test(`a timed Shift roll clears ${course.name}'s elevated beam at entry speed`, () => {
    const beam = course.platforms.find((p) => p.kind === 'obstacle' && p.size[1] === 0.7)!;
    const s = createRunner(course),
      blocked = createRunner(course);
    s.p = [beam.p[0], 5, beam.p[2] - 5];
    blocked.p = [...s.p];
    s.v[2] = blocked.v[2] = M.runSpeed;
    stepRunner(s, { ...idle, forward: 1, roll: true }, course, 'runner', M.step);
    for (let i = 0; i < 84; i++) {
      stepRunner(s, { ...idle, forward: 1 }, course, 'runner', M.step);
      stepRunner(blocked, { ...idle, forward: 1 }, course, 'runner', M.step);
      assert.ok(Math.abs(s.v[2] - M.runSpeed) < 0.01);
    }
    assert.ok(s.p[2] > beam.p[2] + beam.size[2] / 2 + 0.3);
    assert.ok(blocked.p[2] < beam.p[2] - beam.size[2] / 2);
    assert.equal(s.falls, 0);
  });
test('a mistimed roll cannot turn into an unlimited crouch beneath a beam', () => {
  const s = createRunner(elevated);
  s.p = [0, 0, 5];
  s.v[2] = M.runSpeed;
  s.rolling = 0.004;
  s.rollUnderBeam = true;
  s.drive = [0, 1];
  stepRunner(s, { ...idle, forward: 1 }, elevated, 'runner', M.step);
  assert.equal(s.rolling, 0);
  assert.ok(s.p[2] < 3.5);
  assert.ok(s.v[2] < 3);
  assert.equal('crouched' in s, false);
});
for (let kind = 0; kind < TRICKS.length; kind++)
  for (const delay of [0.15, 0.7])
    test(`${TRICKS[kind]} uses the same timing and ${delay < 0.5 ? 'rewards an early' : 'penalizes a late'} second jump press`, () => {
      const s = createRunner(flat),
        plain = createRunner(flat),
        rng = () => kind / TRICKS.length + 0.01;
      s.v[2] = plain.v[2] = M.runSpeed;
      stepRunner(s, { ...idle, forward: 1, jump: true }, flat, 'runner', M.step, rng);
      stepRunner(plain, { ...idle, forward: 1, jump: true }, flat, 'runner', M.step);
      advance(s, flat, { ...idle, forward: 1 }, delay, rng);
      advance(plain, flat, { ...idle, forward: 1 }, delay);
      const vy = s.v[1];
      stepRunner(s, { ...idle, forward: 1, jump: true }, flat, 'runner', M.step, rng);
      stepRunner(plain, { ...idle, forward: 1 }, flat, 'runner', M.step);
      assert.equal(s.pose, TRICKS[kind]);
      assert.ok(s.v[1] < vy);
      assert.ok(Math.abs(s.p[1] - plain.p[1]) < 1e-8);
      while (!s.grounded) {
        stepRunner(s, { ...idle, forward: 1 }, flat, 'runner', M.step, rng);
      }
      assert.equal(s.boost > 0, delay < 0.5);
      assert.equal(s.recovery > 0, delay > 0.5);
      if (delay > 0.5) assert.ok(s.v[2] < M.runSpeed);
    });
test('repeated airborne jump taps cannot chain tricks or add height', () => {
  const s = createRunner(flat);
  stepRunner(s, { ...idle, jump: true }, flat, 'runner', M.step, () => 0);
  advance(s, flat, idle, 0.1);
  stepRunner(s, { ...idle, jump: true }, flat, 'runner', M.step, () => 0);
  assert.equal(s.trick, 'flip');
  advance(s, flat, idle, 0.1);
  const vy = s.v[1];
  stepRunner(s, { ...idle, jump: true }, flat, 'runner', M.step, () => 0.8);
  assert.equal(s.trick, 'flip');
  assert.ok(s.v[1] < vy);
  advance(s, flat, idle, 0.8);
  assert.equal(s.grounded, true);
  assert.equal(s.v[1], 0);
});
const wallCourse: Course = {
  ...flat,
  start: [0.84, 5, 0],
  platforms: [{ p: [0, -5, 20], size: [1, 30, 100], kind: 'wall' }],
};
test('wall running automatically grips, speeds up, descends, and expires', () => {
  const s = createRunner(wallCourse);
  s.grounded = false;
  s.coyote = 0;
  s.v[1] = -8;
  advance(s, wallCourse, { ...idle, forward: 1 }, 0.7);
  assert.equal(s.wallRunning, true);
  assert.ok(s.v[2] > M.runSpeed);
  assert.ok(s.p[1] < 5 && s.p[1] > 3.5);
  advance(s, wallCourse, { ...idle, forward: 1 }, 1.6);
  assert.equal(s.wallRunning, false);
  assert.ok(s.v[1] < -4);
});
test('Space on a wall kicks away instead of selecting a trick or instantly regrabbing', () => {
  const s = createRunner(wallCourse);
  s.grounded = false;
  s.coyote = 0;
  advance(s, wallCourse, { ...idle, forward: 1 }, 0.3);
  stepRunner(s, { ...idle, forward: 1, jump: true }, wallCourse, 'runner', M.step);
  assert.equal(s.pose, 'jump');
  assert.equal(s.trickActive, false);
  assert.ok(s.v[0] > 5);
  assert.ok(s.v[1] > 10);
  assert.ok(s.wallCooldown > 0);
});
test('jump, deliberate dive, roll and restart have distinct default controls', () => {
  assert.equal(DEFAULT_BINDINGS.jump, 'Space');
  assert.equal(DEFAULT_BINDINGS.dive, 'KeyE');
  assert.equal(DEFAULT_BINDINGS.roll, 'ShiftLeft');
  assert.equal(DEFAULT_BINDINGS.restart, 'KeyR');
  for (const key of ['slide', 'flip', 'sprint']) assert.ok(!ACTIONS.some(([a]) => a === key));
  const c = new RunnerControls();
  for (const key of ['KeyC', 'KeyF']) assert.equal(c.down(key, 0), undefined);
  assert.equal(c.down('KeyE', 0), 'dive');
  c.up('KeyE');
  assert.equal(c.consume(600, 0).dive, true);
  assert.equal(c.consume(610, 0).dive, false);
  assert.equal(c.actionFor('ShiftRight'), 'roll');
  assert.equal(c.actionFor('KeyR'), 'restart');
});
test('old default controls migrate while custom keyboard and mouse choices survive', () => {
  const old = {
    ...DEFAULT_BINDINGS,
    roll: 'KeyR',
    sprint: 'ShiftLeft',
    dive: 'KeyE',
    slide: 'KeyC',
    flip: 'KeyF',
  };
  const b = migrateBindings(old);
  assert.equal(b.roll, 'ShiftLeft');
  assert.equal(b.restart, 'KeyR');
  assert.equal(b.dive, 'KeyE');
  const custom = migrateBindings({ ...old, jump: 'KeyG', roll: 'Mouse2', dive: 'KeyV' });
  assert.equal(custom.jump, 'KeyG');
  assert.equal(custom.roll, 'Mouse2');
  assert.equal(custom.dive, 'KeyV');
  const c = new RunnerControls(normalizeBindings(JSON.parse(JSON.stringify(custom))));
  c.down('Mouse2', 0);
  c.up('Mouse2');
  assert.equal(c.consume(600, 0).roll, true);
  assert.equal(c.consume(610, 0).roll, false);
});
test('saved controls from the Space-vault version gain E without resetting custom bindings', () => {
  const { dive, ...previous } = { ...DEFAULT_BINDINGS, jump: 'Mouse2' };
  const b = normalizeBindings(previous);
  assert.equal(b.dive, 'KeyE');
  assert.equal(b.jump, 'Mouse2');
  assert.equal(b.roll, 'ShiftLeft');
  assert.equal(b.restart, 'KeyR');
});
test('conflicting bindings swap and arrow aliases cannot trigger a rebound action twice', () => {
  const b = rebind({ ...DEFAULT_BINDINGS }, 'jump', 'ShiftLeft');
  assert.equal(b.roll, 'Space');
  const c = new RunnerControls(rebind(b, 'jump', 'ArrowUp'));
  c.down('ArrowUp', 0);
  const input = c.consume(10, 0);
  assert.equal(input.jump, true);
  assert.equal(input.forward, 0);
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
test('the queued roll pose tucks before landing without starting the somersault', () => {
  const c = makeCharacter('#c7ef5c');
  c.animate(0, 12, 'roll-ready', { phase: 0 });
  const bounds = new THREE.Box3().setFromObject(c.group);
  assert.ok(bounds.min.y >= 0.02);
  assert.ok(bounds.max.y + M.rollPrepHeight < 1.75, 'fits under the beam while preparing to land');
  assert.equal(c.group.getObjectByName('hips')!.rotation.x, 0);
  assert.ok(c.group.getObjectByName('leftKnee')!.rotation.x > 2);
});
test('a floor crash lies forward, then visibly gets up without sinking through the roof', () => {
  const c = makeCharacter('#c7ef5c');
  c.animate(1, 2, 'crash', { phase: 0 });
  assert.ok(c.group.getObjectByName('hips')!.rotation.x > 1.4);
  for (let i = 0; i <= 10; i++) {
    c.animate(1 + i / 10, 2, 'crash', { phase: i / 10 });
    const bounds = new THREE.Box3().setFromObject(c.group);
    assert.ok(bounds.min.y >= 0.02 && bounds.min.y < 0.035);
  }
  assert.equal(c.group.getObjectByName('hips')!.rotation.x, 0);
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
test('the four airborne tricks have visibly different rotations and finish upright at the same phase', () => {
  const c = makeCharacter('#c7ef5c'),
    rotations = new Set<string>();
  for (const pose of TRICKS) {
    c.animate(1, 10, pose, { phase: 0.25 });
    rotations.add(
      c.group
        .getObjectByName('hips')!
        .quaternion.toArray()
        .map((n) => n.toFixed(3))
        .join(','),
    );
    c.animate(2, 10, pose, { phase: 1 });
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(
      c.group.getObjectByName('hips')!.quaternion,
    );
    assert.ok(up.y > 0.99);
  }
  assert.equal(rotations.size, 4);
});
