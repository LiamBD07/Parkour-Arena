import type { ClassId, Course, Platform, Pose, Vec3 } from '../../shared/game';
import { MOVEMENT as M } from '../../shared/movement';

export interface Input {
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  flip: boolean;
  dive: boolean;
  roll?: boolean;
  ability: boolean;
  yaw: number;
}
export interface VaultMotion {
  start: Vec3;
  near: Vec3;
  across: Vec3;
  end: Vec3;
  contact: Vec3;
  time: number;
  duration: number;
  obstacle: number;
}
export interface RunnerState {
  p: Vec3;
  v: Vec3;
  grounded: boolean;
  checkpoint: number;
  finished: boolean;
  pose: Pose;
  time: number;
  cooldown: number;
  boost: number;
  recovery: number;
  flipTime: number;
  flipStarted: boolean;
  wallRunning: boolean;
  wallSide: number;
  wallTime: number;
  wallCooldown: number;
  falls: number;
  coyote: number;
  jumpBuffer: number;
  hinges: Record<number, number>;
  message: string;
  poseTime: number;
  rolling: number;
  diving: boolean;
  diveUsed: boolean;
  maneuverCooldown: number;
  momentum: number;
  drive: [number, number];
  driveSpeed: number;
  vault: VaultMotion | null;
}
export function createRunner(course: Course): RunnerState {
  return {
    p: [...course.start],
    v: [0, 0, 0],
    grounded: true,
    checkpoint: 0,
    finished: false,
    pose: 'idle',
    time: 0,
    cooldown: 0,
    boost: 0,
    recovery: 0,
    flipTime: 0,
    flipStarted: false,
    wallRunning: false,
    wallSide: 0,
    wallTime: 0,
    wallCooldown: 0,
    falls: 0,
    coyote: M.coyote,
    jumpBuffer: 0,
    hinges: {},
    message: '',
    poseTime: 0,
    rolling: 0,
    diving: false,
    diveUsed: false,
    maneuverCooldown: 0,
    momentum: 0,
    drive: [0, 1],
    driveSpeed: 0,
    vault: null,
  };
}
export function platformTop(p: Platform, index: number, s: RunnerState) {
  const triggered = s.hinges[index];
  const drop =
    triggered !== undefined ? Math.min(30, Math.max(0, s.time - triggered - 1.05) ** 2 * 10) : 0;
  return p.p[1] + p.size[1] / 2 - drop;
}
function pose(s: RunnerState, value: Pose, dt: number) {
  s.poseTime = s.pose === value ? s.poseTime + dt : 0;
  s.pose = value;
}
export function motionPhase(s: RunnerState) {
  if (s.vault) return Math.min(1, s.vault.time / s.vault.duration);
  if (s.pose === 'roll') return Math.min(1, 1 - s.rolling / M.rollDuration);
  if (s.pose === 'flip') return Math.min(1, s.flipTime / 0.72);
  return Math.min(1, s.poseTime / 0.55);
}
function advanceCourse(s: RunnerState, course: Course) {
  const cp = course.checkpoints[s.checkpoint + 1];
  if (
    cp &&
    Math.abs(s.p[2] - cp.p[2]) < 4 &&
    Math.abs(s.p[0] - cp.p[0]) < 8 &&
    Math.abs(s.p[1] - cp.p[1]) < 4
  ) {
    s.checkpoint++;
    s.message = s.checkpoint === course.checkpoints.length - 1 ? 'FINISH' : 'CHECKPOINT';
    s.finished = s.checkpoint === course.checkpoints.length - 1;
  }
  for (const key of Object.keys(s.hinges))
    if (s.time - s.hinges[Number(key)] > 5) delete s.hinges[Number(key)];
  if (s.p[1] < -13) {
    const checkpoint = s.checkpoint,
      falls = s.falls + 1,
      time = s.time,
      cooldown = s.cooldown;
    Object.assign(s, createRunner(course));
    s.checkpoint = checkpoint;
    s.falls = falls;
    s.time = time;
    s.cooldown = cooldown;
    s.p = [...course.checkpoints[checkpoint].p];
    s.recovery = 0.15;
    s.message = 'BACK ON YOUR FEET';
  }
}
function horizontalRay(p: Vec3, direction: [number, number], box: Platform) {
  let entry = -Infinity,
    exit = Infinity;
  for (const [axis, d] of [
    [0, direction[0]],
    [2, direction[1]],
  ] as const) {
    const lo = box.p[axis] - box.size[axis] / 2 - 0.22,
      hi = box.p[axis] + box.size[axis] / 2 + 0.22;
    if (Math.abs(d) < 1e-5) {
      if (p[axis] < lo || p[axis] > hi) return null;
    } else {
      const a = (lo - p[axis]) / d,
        b = (hi - p[axis]) / d;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
  }
  return exit >= Math.max(0, entry) ? { entry, exit } : null;
}
function mix(a: Vec3, b: Vec3, k: number): Vec3 {
  return a.map((v, i) => v + (b[i] - v) * k) as Vec3;
}
function smooth(k: number) {
  return k * k * (3 - 2 * k);
}
export function sampleVault(v: VaultMotion, u: number): Vec3 {
  if (u < 0.4) {
    const k = smooth(u / 0.4);
    const p = mix(v.start, v.near, k);
    p[1] = v.start[1] + (v.contact[1] + 0.22 - v.start[1]) * k;
    return p;
  }
  if (u < 0.75) {
    const k = (u - 0.4) / 0.35;
    const p = mix(v.near, v.across, k);
    p[1] = v.contact[1] + 0.22 + Math.sin(k * Math.PI) * 0.18;
    return p;
  }
  const k = smooth(Math.min(1, (u - 0.75) / 0.25));
  const p = mix(v.across, v.end, k);
  p[1] = (v.contact[1] + 0.22) * (1 - k) + v.end[1] * k;
  return p;
}
function findVault(
  s: RunnerState,
  direction: [number, number],
  course: Course,
): VaultMotion | null {
  const candidates = course.platforms
    .map((p, i) => ({ p, i, ray: p.kind === 'obstacle' ? horizontalRay(s.p, direction, p) : null }))
    .filter(
      ({ p, i, ray }) =>
        ray &&
        ray.entry >= -0.3 &&
        ray.entry <= 4.5 &&
        ray.exit < 8.5 &&
        platformTop(p, i, s) - s.p[1] >= 0.45 &&
        platformTop(p, i, s) - s.p[1] <= 2.85,
    )
    .sort((a, b) => a.ray!.entry - b.ray!.entry);
  for (const { p, i, ray } of candidates) {
    const end: Vec3 = [
      s.p[0] + direction[0] * (ray!.exit + 1.1),
      s.p[1],
      s.p[2] + direction[1] * (ray!.exit + 1.1),
    ];
    const landing = course.platforms.find(
      (roof, j) =>
        j !== i &&
        roof.kind !== 'wall' &&
        roof.kind !== 'obstacle' &&
        Math.abs(end[0] - roof.p[0]) < roof.size[0] / 2 - 0.3 &&
        Math.abs(end[2] - roof.p[2]) < roof.size[2] / 2 - 0.3 &&
        Math.abs(platformTop(roof, j, s) - s.p[1]) < 1.3,
    );
    if (!landing) continue;
    end[1] = platformTop(landing, course.platforms.indexOf(landing), s);
    const top = platformTop(p, i, s);
    const v: VaultMotion = {
      start: [...s.p],
      near: [
        s.p[0] + direction[0] * Math.max(0, ray!.entry - 0.35),
        top + 0.22,
        s.p[2] + direction[1] * Math.max(0, ray!.entry - 0.35),
      ],
      across: [
        s.p[0] + direction[0] * (ray!.exit + 0.35),
        top + 0.22,
        s.p[2] + direction[1] * (ray!.exit + 0.35),
      ],
      end,
      contact: [
        s.p[0] + direction[0] * Math.max(0, ray!.entry + 0.12),
        top + 0.04,
        s.p[2] + direction[1] * Math.max(0, ray!.entry + 0.12),
      ],
      time: 0,
      duration: Math.max(0.52, Math.min(0.76, (ray!.exit + 1.1) / 13.5)),
      obstacle: i,
    };
    // Do not pull through an unrelated beam or wall beside the target.
    const blocked = Array.from({ length: 16 }, (_, n) => sampleVault(v, n / 15)).some((point) =>
      course.platforms.some(
        (other, j) =>
          j !== i &&
          (other.kind === 'wall' || other.kind === 'obstacle') &&
          Math.abs(point[0] - other.p[0]) < other.size[0] / 2 + 0.25 &&
          Math.abs(point[2] - other.p[2]) < other.size[2] / 2 + 0.25 &&
          point[1] < platformTop(other, j, s) - 0.05 &&
          point[1] + 1.1 > other.p[1] - other.size[1] / 2,
      ),
    );
    if (!blocked) return v;
  }
  return null;
}
export function stepRunner(
  s: RunnerState,
  input: Input,
  course: Course,
  classId: ClassId,
  dt: number,
) {
  if (s.finished) return;
  s.time += dt;
  s.message = '';
  for (const key of [
    'cooldown',
    'boost',
    'recovery',
    'wallCooldown',
    'rolling',
    'maneuverCooldown',
    'momentum',
  ] as const)
    s[key] = Math.max(0, s[key] - dt);
  s.jumpBuffer = input.jump ? M.jumpBuffer : Math.max(0, s.jumpBuffer - dt);
  if (s.grounded) {
    s.coyote = M.coyote;
    s.wallTime = 0;
    s.diveUsed = false;
  } else s.coyote = Math.max(0, s.coyote - dt);
  const length = Math.hypot(input.forward, input.right) || 1;
  const forward = input.forward / length,
    right = input.right / length;
  const dx = Math.sin(input.yaw) * forward - Math.cos(input.yaw) * right,
    dz = Math.cos(input.yaw) * forward + Math.sin(input.yaw) * right;
  const direction: [number, number] =
    Math.hypot(dx, dz) > 0.1 ? [dx, dz] : [Math.sin(input.yaw), Math.cos(input.yaw)];
  let wall: { platform: Platform; axis: 0 | 2; side: number } | undefined;
  for (const p of course.platforms) {
    if (p.kind !== 'wall') continue;
    const axis = p.size[0] < p.size[2] ? 0 : 2,
      along = axis === 0 ? 2 : 0;
    if (
      Math.abs(s.p[axis] - p.p[axis]) < p.size[axis] / 2 + 0.8 &&
      Math.abs(s.p[along] - p.p[along]) < p.size[along] / 2 + 0.1 &&
      s.p[1] + 1.5 > p.p[1] - p.size[1] / 2 &&
      s.p[1] + 0.3 < p.p[1] + p.size[1] / 2
    ) {
      wall = { platform: p, axis, side: Math.sign(s.p[axis] - p.p[axis]) || 1 };
      break;
    }
  }
  s.wallRunning = Boolean(
    !s.grounded &&
    wall &&
    s.wallCooldown <= 0 &&
    s.wallTime < M.wallDuration &&
    !s.diving &&
    !s.vault &&
    (Math.hypot(dx, dz) > 0.1 || Math.hypot(s.v[0], s.v[2]) > 2),
  );
  s.wallSide = wall ? wall.side : 0;
  if (input.ability && s.cooldown <= 0) {
    if (classId === 'runner') {
      s.boost = 1.8;
      s.cooldown = 12;
      s.message = 'SECOND WIND';
    }
    if (classId === 'acrobat' && !s.grounded) {
      s.v[1] = 9;
      s.cooldown = 14;
      s.message = 'AIR STEP';
    }
    if (classId === 'traceur' && wall) {
      s.v[1] = 12;
      s.v[wall.axis] = wall.side * 7;
      s.cooldown = 10;
      s.wallCooldown = 0.3;
      s.wallRunning = false;
      s.grounded = false;
      s.message = 'WALL KICK';
    }
  }
  if (input.dive && s.maneuverCooldown <= 0 && !s.vault && (!s.diveUsed || s.grounded)) {
    const vault = findVault(s, direction, course);
    s.maneuverCooldown = 0.6;
    s.flipStarted = false;
    s.rolling = 0;
    s.drive = direction;
    s.driveSpeed = M.diveSpeed;
    if (vault) {
      s.vault = vault;
      s.grounded = false;
      s.wallRunning = false;
      s.message = 'PULL VAULT';
    } else {
      s.diving = true;
      s.diveUsed = true;
      s.v[1] = s.grounded || s.coyote > 0 ? M.diveLift : Math.max(s.v[1], 2.2);
      s.grounded = false;
      s.coyote = 0;
      s.wallRunning = false;
      s.wallCooldown = 0.25;
      s.v[0] = direction[0] * M.diveSpeed;
      s.v[2] = direction[1] * M.diveSpeed;
      s.momentum = 0.5;
      s.message = 'DIVE';
    }
  }
  if (s.vault) {
    const v = s.vault;
    v.time = Math.min(v.duration, v.time + dt);
    const phase = v.time / v.duration;
    const next = sampleVault(v, phase);
    s.v = next.map((x, i) => (x - s.p[i]) / dt) as Vec3;
    s.p = next;
    if (s.jumpBuffer > 0 && phase >= 0.4) {
      s.vault = null;
      s.coyote = M.coyote;
    } else {
      pose(s, 'vault', dt);
      if (phase >= 1) {
        s.vault = null;
        s.grounded = true;
        s.v[1] = 0;
        s.v[0] = s.drive[0] * M.diveSpeed;
        s.v[2] = s.drive[1] * M.diveSpeed;
        s.momentum = 0.38;
        s.boost = 0.35;
        s.message = 'VAULT BOOST';
      }
      advanceCourse(s, course);
      return;
    }
  }
  if (input.roll && s.grounded && s.maneuverCooldown <= 0) {
    s.rolling = M.rollDuration;
    s.maneuverCooldown = 0.72;
    s.drive = direction;
    s.driveSpeed = Math.max(6, Math.hypot(s.v[0], s.v[2]));
    s.momentum = M.rollDuration;
    s.message = 'GROUND ROLL';
  }
  if (s.jumpBuffer > 0 && (s.coyote > 0 || s.wallRunning)) {
    s.v[1] = s.wallRunning ? 11.4 : M.jumpSpeed;
    if (s.wallRunning && wall) {
      s.v[wall.axis] = wall.side * 6.5;
      s.wallCooldown = 0.3;
      s.message = 'WALL JUMP';
    }
    s.grounded = false;
    s.coyote = 0;
    s.jumpBuffer = 0;
    s.wallRunning = false;
    s.rolling = 0;
    s.diving = false;
    s.momentum = 0;
  }
  if (input.flip && !s.grounded && !s.flipStarted && !s.diving) {
    s.flipStarted = true;
    s.flipTime = 0;
  }
  if (s.flipStarted) s.flipTime += dt;
  let speed: number = input.sprint ? M.sprintSpeed : M.runSpeed;
  if (s.boost > 0) speed *= 1.45;
  if (s.recovery > 0) speed *= 0.65;
  if (input.crouch && s.grounded) speed *= input.sprint ? 1.04 : 0.55;
  let targetX = dx * speed,
    targetZ = dz * speed;
  let acceleration = s.grounded ? 15 : 4.5;
  if (s.momentum > 0) {
    targetX = s.drive[0] * s.driveSpeed;
    targetZ = s.drive[1] * s.driveSpeed;
    acceleration = 7;
  }
  if (s.wallRunning && wall) {
    const along = wall.axis === 0 ? 2 : 0;
    const sign = Math.sign((along === 2 ? dz : dx) || s.v[along]) || 1;
    const wallSpeed = Math.max(M.wallSpeed, speed);
    targetX = wall.axis === 0 ? 0 : sign * wallSpeed;
    targetZ = wall.axis === 2 ? 0 : sign * wallSpeed;
    acceleration = 18;
    s.wallTime += dt;
    s.p[wall.axis] =
      wall.platform.p[wall.axis] + wall.side * (wall.platform.size[wall.axis] / 2 + 0.34);
    s.v[1] = -M.wallDescent - s.wallTime * 0.35;
    s.message = 'WALL RUN';
  } else s.v[1] -= M.gravity * dt;
  s.v[0] += (targetX - s.v[0]) * Math.min(1, dt * acceleration);
  s.v[2] += (targetZ - s.v[2]) * Math.min(1, dt * acceleration);
  const previous = [...s.p];
  const next = s.p.map((value, i) => value + s.v[i] * dt) as Vec3;
  const height = input.crouch || s.diving || s.rolling > 0 ? 0.8 : 1.8;
  let grounded = false;
  for (let i = 0; i < course.platforms.length; i++) {
    const p = course.platforms[i],
      top = platformTop(p, i, s),
      bottom = top - p.size[1];
    const insideX = Math.abs(next[0] - p.p[0]) < p.size[0] / 2 + 0.28;
    const insideZ = Math.abs(next[2] - p.p[2]) < p.size[2] / 2 + 0.28;
    const carried =
      p.kind === 'hinge' &&
      s.grounded &&
      Math.abs(previous[1] - platformTop(p, i, { ...s, time: s.time - dt })) < 0.12;
    if (
      insideX &&
      insideZ &&
      ((previous[1] >= top - 0.12 && next[1] <= top && s.v[1] <= 0) || carried)
    ) {
      next[1] = top;
      s.v[1] = 0;
      grounded = true;
      if (p.kind === 'hinge' && s.hinges[i] === undefined) s.hinges[i] = s.time;
    } else if (insideX && insideZ && next[1] < top - 0.1 && next[1] + height > bottom + 0.05) {
      const wasX = Math.abs(previous[0] - p.p[0]) >= p.size[0] / 2 + 0.27;
      const wasZ = Math.abs(previous[2] - p.p[2]) >= p.size[2] / 2 + 0.27;
      if (wasX) {
        next[0] = previous[0];
        s.v[0] = 0;
      }
      if (wasZ) {
        next[2] = previous[2];
        s.v[2] = 0;
      }
      if (!wasX && !wasZ && previous[1] + height <= bottom + 0.15) {
        next[1] = bottom - height;
        s.v[1] = Math.min(0, s.v[1]);
      }
    }
  }
  if (grounded && !s.grounded) {
    if (s.flipStarted) {
      if (s.flipTime >= 0.65) {
        s.boost = 1.15;
        s.message = 'CLEAN LANDING + BOOST';
      } else {
        s.recovery = 0.6;
        s.message = 'SHORT FLIP · RECOVERING';
      }
    }
    s.flipStarted = false;
    s.flipTime = 0;
    if (s.diving) {
      s.rolling = M.rollDuration;
      s.momentum = M.rollDuration;
      s.driveSpeed = Math.max(10, Math.min(16, Math.hypot(s.v[0], s.v[2])));
      s.message = 'DIVE ROLL';
    }
    s.diving = false;
    s.diveUsed = false;
  }
  s.grounded = grounded;
  s.p = next;
  if (grounded)
    pose(
      s,
      s.rolling > 0
        ? 'roll'
        : input.crouch
          ? 'slide'
          : Math.hypot(s.v[0], s.v[2]) > 0.5
            ? 'run'
            : 'idle',
      dt,
    );
  else
    pose(
      s,
      s.wallRunning
        ? 'wallrun'
        : s.diving
          ? 'dive'
          : s.flipStarted
            ? 'flip'
            : s.v[1] > 0
              ? 'jump'
              : 'fall',
      dt,
    );
  advanceCourse(s, course);
}
