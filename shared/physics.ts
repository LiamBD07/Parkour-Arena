import type { ClassId, Course, Platform, Pose, Vec3 } from './game';
import { MOVEMENT as M, TRICKS, TRICK_NAMES, isTrick, type TrickPose } from './movement';

export interface Input {
  forward: number;
  right: number;
  jump: boolean;
  dive: boolean;
  roll: boolean;
  ability: boolean;
  yaw: number;
}
export interface VaultMotion {
  start: Vec3;
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
  trickTime: number;
  trickActive: boolean;
  trickUsed: boolean;
  trick: TrickPose;
  airJumped: boolean;
  wallRunning: boolean;
  wallSide: number;
  wallTime: number;
  wallRise: number;
  wallCooldown: number;
  falls: number;
  coyote: number;
  jumpBuffer: number;
  hinges: Record<number, number>;
  message: string;
  poseTime: number;
  rolling: number;
  rollBuffer: number;
  rollReady: boolean;
  rollUnderBeam: boolean;
  crashTime: number;
  diving: boolean;
  diveObstacle: number | null;
  diveFloor: number;
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
    trickTime: 0,
    trickActive: false,
    trickUsed: false,
    trick: 'flip',
    airJumped: false,
    wallRunning: false,
    wallSide: 0,
    wallTime: 0,
    wallRise: 0,
    wallCooldown: 0,
    falls: 0,
    coyote: M.coyote,
    jumpBuffer: 0,
    hinges: {},
    message: '',
    poseTime: 0,
    rolling: 0,
    rollBuffer: 0,
    rollReady: false,
    rollUnderBeam: false,
    crashTime: 0,
    diving: false,
    diveObstacle: null,
    diveFloor: course.start[1],
    maneuverCooldown: 0,
    momentum: 0,
    drive: [0, 1],
    driveSpeed: 0,
    vault: null,
  };
}
export function motionPhase(s: RunnerState) {
  if (s.vault) return Math.min(1, s.vault.time / s.vault.duration);
  if (s.pose === 'roll') return Math.min(1, 1 - s.rolling / M.rollDuration);
  if (isTrick(s.pose)) return Math.min(1, s.trickTime / M.trickDuration);
  if (s.pose === 'crash') return Math.min(1, 1 - s.crashTime / M.crashDuration);
  return Math.min(1, s.poseTime / 0.55);
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
function horizontalRay(
  p: Vec3,
  direction: [number, number],
  box: Platform,
  padding = 0.22,
  allowPast = false,
) {
  let entry = -Infinity,
    exit = Infinity;
  for (const [axis, d] of [
    [0, direction[0]],
    [2, direction[1]],
  ] as const) {
    const lo = box.p[axis] - box.size[axis] / 2 - padding,
      hi = box.p[axis] + box.size[axis] / 2 + padding;
    if (Math.abs(d) < 1e-5) {
      if (p[axis] < lo || p[axis] > hi) return null;
    } else {
      const a = (lo - p[axis]) / d,
        b = (hi - p[axis]) / d;
      entry = Math.max(entry, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
  }
  return exit >= entry && (allowPast || exit >= Math.max(0, entry)) ? { entry, exit } : null;
}
function underBeam(s: RunnerState, course: Course) {
  return course.platforms.find((p, i) => {
    const gap = platformTop(p, i, s) - p.size[1] - s.p[1];
    return (
      p.kind === 'obstacle' &&
      gap >= 0.8 &&
      gap < 1.8 &&
      Math.abs(s.p[0] - p.p[0]) < p.size[0] / 2 + 0.28 &&
      Math.abs(s.p[2] - p.p[2]) < p.size[2] / 2 + 0.28
    );
  });
}
function rollCanClearBeam(s: RunnerState, direction: [number, number], course: Course) {
  const speed = Math.hypot(s.v[0], s.v[2]);
  return (
    speed > M.walkSpeed &&
    course.platforms.some((p, i) => {
      const gap = platformTop(p, i, s) - p.size[1] - s.p[1],
        ray = horizontalRay(s.p, direction, p);
      return (
        p.kind === 'obstacle' &&
        gap >= 1.25 &&
        gap < 1.8 &&
        ray &&
        ray.exit > 0 &&
        ray.exit + 0.3 <= speed * M.rollDuration
      );
    })
  );
}
function floorAt(s: RunnerState, course: Course, point: Vec3): number | undefined {
  let floor: number | undefined;
  for (let i = 0; i < course.platforms.length; i++) {
    const p = course.platforms[i],
      top = platformTop(p, i, s);
    if (p.kind === 'wall' || p.kind === 'obstacle' || top > s.p[1] + 0.15) continue;
    if (
      Math.abs(point[0] - p.p[0]) < p.size[0] / 2 + 0.28 &&
      Math.abs(point[2] - p.p[2]) < p.size[2] / 2 + 0.28
    )
      floor = floor === undefined ? top : Math.max(floor, top);
  }
  return floor;
}
function lowBeamFloor(s: RunnerState, course: Course, index: number): number | undefined {
  const beam = course.platforms[index];
  if (beam.kind !== 'obstacle') return;
  const floor = floorAt(s, course, beam.p),
    top = platformTop(beam, index, s);
  if (
    floor !== undefined &&
    top - beam.size[1] <= floor + 0.25 &&
    top - floor >= 0.4 &&
    top - floor <= 1.65
  )
    return floor;
}
/** The roof beneath the beam determines eligibility, even when the runner is airborne. */
function diveTarget(s: RunnerState, direction: [number, number], course: Course) {
  return course.platforms
    .map((p, i) => ({
      p,
      i,
      ray: horizontalRay(s.p, direction, p),
      floor: lowBeamFloor(s, course, i),
    }))
    .filter(
      ({ ray, floor }) => ray && ray.exit > 0 && ray.entry <= M.vaultReach && floor !== undefined,
    )
    .sort((a, b) => Math.max(0, a.ray!.entry) - Math.max(0, b.ray!.entry))[0];
}
export function beamProgress(point: Vec3, direction: [number, number], beam: Platform) {
  const ray = horizontalRay(point, direction, beam, 0, true);
  if (ray && ray.exit - ray.entry > 1e-6) return -ray.entry / (ray.exit - ray.entry);
  const axis = Math.abs(direction[0]) > Math.abs(direction[1]) ? 0 : 2;
  const sign = Math.sign(direction[axis === 0 ? 0 : 1]) || 1;
  return ((point[axis] - beam.p[axis]) * sign + beam.size[axis] / 2) / beam.size[axis];
}
/** A forward dive lands on its outstretched hands as well as its feet. */
function diveHandContact(s: RunnerState, course: Course, previous: Vec3, next: Vec3) {
  if (!s.diving || s.v[1] >= 0) return;
  let first: { index: number; floor: number; time: number; root: Vec3; point: Vec3 } | undefined;
  course.platforms.forEach((beam, index) => {
    const floor = lowBeamFloor(s, course, index);
    if (floor === undefined) return;
    const top = platformTop(beam, index, s),
      from = previous[1] + M.diveHandHeight,
      to = next[1] + M.diveHandHeight;
    if (from < top || to > top) return;
    const time = (from - top) / (from - to),
      root = previous.map((n, axis) => n + (next[axis] - n) * time) as Vec3,
      point: Vec3 = [
        root[0] + s.drive[0] * M.diveHandReach,
        top,
        root[2] + s.drive[1] * M.diveHandReach,
      ];
    if (
      Math.abs(point[0] - beam.p[0]) <= beam.size[0] / 2 &&
      Math.abs(point[2] - beam.p[2]) <= beam.size[2] / 2 &&
      beamProgress(point, s.drive, beam) >= 0.25 - 1e-6 &&
      (!first || time < first.time)
    )
      first = { index, floor, time, root, point };
  });
  return first;
}
function pullOverBeam(
  s: RunnerState,
  course: Course,
  index: number,
  contact: Vec3 = s.p,
): VaultMotion | null {
  const beam = course.platforms[index],
    ray = horizontalRay(s.p, s.drive, beam);
  if (!ray) return null;
  const top = platformTop(beam, index, s);
  for (const clearance of [2, 1.1]) {
    const end: Vec3 = [
      s.p[0] + s.drive[0] * (ray.exit + clearance),
      s.diveFloor,
      s.p[2] + s.drive[1] * (ray.exit + clearance),
    ];
    const roof = course.platforms.find(
      (p, i) =>
        p.kind !== 'wall' &&
        p.kind !== 'obstacle' &&
        Math.abs(end[0] - p.p[0]) < p.size[0] / 2 - 0.28 &&
        Math.abs(end[2] - p.p[2]) < p.size[2] / 2 - 0.28 &&
        Math.abs(platformTop(p, i, s) - s.diveFloor) < 1.3,
    );
    if (!roof) continue;
    end[1] = platformTop(roof, course.platforms.indexOf(roof), s);
    const across: Vec3 = [
      s.p[0] + s.drive[0] * (ray.exit + 0.15),
      top + 0.18,
      s.p[2] + s.drive[1] * (ray.exit + 0.15),
    ];
    const distance = Math.hypot(end[0] - s.p[0], end[2] - s.p[2]);
    return {
      start: [...s.p],
      across,
      end,
      contact: [contact[0], top + 0.04, contact[2]],
      time: 0,
      duration: distance / M.vaultSpeed,
      obstacle: index,
    };
  }
  return null;
}
export function sampleVault(v: VaultMotion, u: number): Vec3 {
  const phase = Math.max(0, Math.min(1, u));
  const point = v.start.map((n, i) => n + (v.end[i] - n) * phase) as Vec3;
  const distance = Math.hypot(v.end[0] - v.start[0], v.end[2] - v.start[2]);
  const lip = Math.hypot(v.across[0] - v.start[0], v.across[2] - v.start[2]) / distance;
  if (phase <= lip)
    point[1] =
      v.start[1] +
      Math.sin(((phase / Math.max(0.01, lip)) * Math.PI) / 2) * (v.across[1] - v.start[1]);
  else point[1] = v.across[1] + ((v.end[1] - v.across[1]) * (phase - lip)) / (1 - lip);
  return point;
}
function startPull(s: RunnerState, pull: VaultMotion) {
  s.vault = pull;
  s.diving = false;
  s.diveObstacle = null;
  s.grounded = false;
  s.trickActive = false;
  s.rollReady = false;
  s.recovery = 0;
  s.boost = Math.max(s.boost, M.vaultBoostDuration);
  s.driveSpeed = M.vaultSpeed;
  s.v[0] = s.drive[0] * M.vaultSpeed;
  s.v[2] = s.drive[1] * M.vaultSpeed;
  s.message = 'HAND PULL · SPEED BOOST';
}
function startRoll(s: RunnerState, direction: [number, number], course: Course) {
  if (s.rollBuffer <= 0 || !s.grounded || s.rolling > 0 || s.crashTime > 0 || s.diving || s.vault)
    return false;
  s.rollBuffer = 0;
  s.rollReady = false;
  s.rolling = M.rollDuration;
  s.maneuverCooldown = 0.72;
  s.rollUnderBeam = !!rollCanClearBeam(s, direction, course);
  s.drive = direction;
  s.driveSpeed = Math.hypot(s.v[0], s.v[2]);
  s.momentum = s.rollUnderBeam ? M.rollDuration : 0;
  if (!s.rollUnderBeam && s.driveSpeed > M.walkSpeed) {
    s.v[0] *= M.walkSpeed / s.driveSpeed;
    s.v[2] *= M.walkSpeed / s.driveSpeed;
  }
  s.message = s.rollUnderBeam ? 'BEAM ROLL · KEEP YOUR SPEED' : 'ROLL · SPRINT PAUSED';
  return true;
}
function crash(s: RunnerState, message: string) {
  s.diving = false;
  s.diveObstacle = null;
  s.rolling = 0;
  s.rollBuffer = 0;
  s.rollReady = false;
  s.rollUnderBeam = false;
  s.momentum = 0;
  s.boost = 0;
  s.trickActive = false;
  s.crashTime = M.crashDuration;
  s.v[0] *= 0.18;
  s.v[2] *= 0.18;
  s.maneuverCooldown = Math.max(s.maneuverCooldown, M.crashDuration);
  s.message = message;
}
export function stepRunner(
  s: RunnerState,
  input: Input,
  course: Course,
  classId: ClassId,
  dt: number,
  random: () => number = Math.random,
) {
  if (s.finished) return;
  s.time += dt;
  s.message = '';
  const wasRolling = s.rolling > 0;
  for (const key of [
    'cooldown',
    'boost',
    'recovery',
    'wallCooldown',
    'rolling',
    'rollBuffer',
    'crashTime',
    'maneuverCooldown',
    'momentum',
  ] as const)
    s[key] = Math.max(0, s[key] - dt);
  s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
  s.rollReady = false;
  if (input.roll && s.crashTime <= 0) s.rollBuffer = M.rollBuffer;
  if (s.rolling <= 0) {
    s.rollUnderBeam = false;
    // A mistimed roll cannot turn into an unlimited crouch under the obstacle.
    const beam = wasRolling ? underBeam(s, course) : undefined;
    if (beam) {
      const axis = Math.abs(s.drive[0]) > Math.abs(s.drive[1]) ? 0 : 2;
      const sign = Math.sign(s.drive[axis === 0 ? 0 : 1]) || 1;
      s.p[axis] = beam.p[axis] - sign * (beam.size[axis] / 2 + 0.3);
      s.v[0] = s.v[2] = 0;
      s.momentum = 0;
      s.recovery = 0.25;
      s.message = 'ROLL TIMING MISSED · MOMENTUM LOST';
    }
  }
  if (s.grounded) {
    s.coyote = M.coyote;
    s.wallTime = 0;
    s.wallRise = 0;
    s.airJumped = false;
    s.trickUsed = false;
    s.diveFloor = floorAt(s, course, s.p) ?? s.diveFloor;
  } else s.coyote = Math.max(0, s.coyote - dt);
  const length = Math.hypot(input.forward, input.right) || 1;
  const forward = input.forward / length,
    right = input.right / length;
  const dx = Math.sin(input.yaw) * forward - Math.cos(input.yaw) * right;
  const dz = Math.cos(input.yaw) * forward + Math.sin(input.yaw) * right;
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
  const previouslyWallRunning = s.wallRunning;
  s.wallRunning = Boolean(
    !s.grounded &&
    wall &&
    s.wallCooldown <= 0 &&
    s.wallTime < M.wallDuration &&
    !s.diving &&
    !s.vault &&
    s.crashTime <= 0 &&
    (Math.hypot(dx, dz) > 0.1 || Math.hypot(s.v[0], s.v[2]) > 2),
  );
  if (s.wallRunning && !previouslyWallRunning) s.wallRise = Math.max(0, Math.min(8, s.v[1]));
  s.wallSide = wall ? wall.side : 0;
  if (s.wallRunning) s.trickActive = false;
  if (input.ability && s.cooldown <= 0) {
    if (classId === 'runner') {
      s.boost = 1.8;
      s.cooldown = 12;
      s.message = 'SECOND WIND';
    }
    if (classId === 'acrobat' && !s.grounded && !s.diving && !s.vault) {
      s.v[1] = 9;
      s.cooldown = 14;
      s.airJumped = true;
      s.message = 'AIR STEP';
    }
    if (classId === 'traceur' && wall) {
      s.v[1] = 12;
      s.v[wall.axis] = wall.side * 7;
      s.cooldown = 10;
      s.wallCooldown = 0.3;
      s.wallRunning = false;
      s.grounded = false;
      s.airJumped = true;
      s.message = 'WALL KICK';
    }
  }
  if (input.dive && s.crashTime <= 0 && s.maneuverCooldown <= 0 && !s.diving && !s.vault) {
    const target = diveTarget(s, direction, course),
      wasGrounded = s.grounded || s.coyote > 0;
    s.drive = direction;
    s.diveFloor = target?.floor ?? floorAt(s, course, s.p) ?? s.diveFloor;
    let lift = wasGrounded ? M.diveLift : Math.min(s.v[1], -1.8);
    let launchSpeed = Math.max(M.runSpeed, Math.hypot(s.v[0], s.v[2]));
    if (target) {
      const height = platformTop(target.p, target.i, s) - s.p[1];
      if (wasGrounded) lift = Math.sqrt(2 * M.gravity * (Math.max(0, height) + 0.15));
      else if (height > 0 && s.v[1] > 0) lift = s.v[1];
      const discriminant = lift * lift - 2 * M.gravity * height;
      if (discriminant >= 0) {
        const flight = (lift + Math.sqrt(discriminant)) / M.gravity;
        const aim = Math.max(
          0.15,
          (target.ray!.entry + target.ray!.exit) / 2 +
            Math.min(0.35, (target.ray!.exit - target.ray!.entry) * 0.2),
        );
        if (flight > 0) launchSpeed = Math.min(launchSpeed, aim / flight);
      }
    }
    s.v[0] = direction[0] * launchSpeed;
    s.v[2] = direction[1] * launchSpeed;
    s.v[1] = lift;
    s.driveSpeed = launchSpeed;
    s.diving = true;
    s.diveObstacle = target?.i ?? null;
    s.grounded = false;
    s.coyote = 0;
    s.jumpBuffer = 0;
    s.wallRunning = false;
    s.wallCooldown = 0.25;
    s.airJumped = true;
    s.trickActive = false;
    s.trickUsed = true;
    s.rolling = 0;
    s.rollUnderBeam = false;
    s.momentum = 0;
    s.maneuverCooldown = 0.5;
    s.message = target ? 'BEAM DIVE' : 'DIVE';
  }
  if (s.vault) {
    const v = s.vault;
    v.time = Math.min(v.duration, v.time + dt);
    const phase = v.time / v.duration,
      next = sampleVault(v, phase),
      beam = course.platforms[v.obstacle];
    s.v = next.map((n, i) => (n - s.p[i]) / dt) as Vec3;
    s.p = next;
    s.jumpBuffer = 0;
    v.contact = [
      Math.max(
        beam.p[0] - beam.size[0] / 2 + 0.08,
        Math.min(beam.p[0] + beam.size[0] / 2 - 0.08, s.p[0] + s.drive[0] * 0.2),
      ),
      platformTop(beam, v.obstacle, s) + 0.04,
      Math.max(
        beam.p[2] - beam.size[2] / 2 + 0.08,
        Math.min(beam.p[2] + beam.size[2] / 2 - 0.08, s.p[2] + s.drive[1] * 0.2),
      ),
    ];
    pose(s, 'vault', dt);
    if (phase >= 1) {
      s.vault = null;
      s.grounded = true;
      s.v[1] = 0;
      s.v[0] = s.drive[0] * M.vaultSpeed;
      s.v[2] = s.drive[1] * M.vaultSpeed;
      s.driveSpeed = M.vaultSpeed;
      s.momentum = 0.35;
      s.boost = Math.max(s.boost, M.vaultBoostDuration);
      s.recovery = 0;
      startRoll(s, direction, course);
      s.message = 'VAULT BOOST';
    }
    advanceCourse(s, course);
    return;
  }
  if (input.jump && !s.diving) {
    if (s.grounded || s.coyote > 0 || s.wallRunning || !s.airJumped) s.jumpBuffer = M.jumpBuffer;
    else if (!s.trickUsed && s.crashTime <= 0) {
      const index = Math.min(TRICKS.length - 1, Math.max(0, Math.floor(random() * TRICKS.length)));
      s.trick = TRICKS[index];
      s.trickActive = true;
      s.trickUsed = true;
      s.trickTime = 0;
      s.message = TRICK_NAMES[s.trick];
    }
  }
  startRoll(s, direction, course);
  if (s.jumpBuffer > 0 && (s.coyote > 0 || s.wallRunning)) {
    s.v[1] = s.wallRunning ? 11.4 : M.jumpSpeed;
    if (s.wallRunning && wall) {
      s.v[wall.axis] = wall.side * 6.5;
      s.wallCooldown = 0.3;
      s.message = 'WALL JUMP';
    }
    s.diving = false;
    s.diveObstacle = null;
    s.grounded = false;
    s.coyote = 0;
    s.jumpBuffer = 0;
    s.wallRunning = false;
    s.airJumped = true;
    s.trickActive = false;
    s.trickUsed = false;
    s.rolling = 0;
    s.rollUnderBeam = false;
    s.momentum = 0;
  }
  if (s.trickActive) s.trickTime += dt;
  let speed = M.runSpeed as number;
  if (s.boost > 0) speed *= 1.45;
  if (s.recovery > 0) speed *= 0.65;
  if (s.crashTime > 0) speed = M.crashSpeed;
  else if (s.rolling > 0 && !s.rollUnderBeam) speed = M.walkSpeed;
  let targetX = dx * speed,
    targetZ = dz * speed,
    acceleration = s.grounded ? 15 : 4.5;
  if (s.momentum > 0) {
    targetX = s.drive[0] * s.driveSpeed;
    targetZ = s.drive[1] * s.driveSpeed;
    acceleration = 7;
  }
  if (s.diving) {
    const steering = Math.hypot(dx, dz) > 0.1;
    targetX = s.drive[0] * s.driveSpeed + (steering ? dx - s.drive[0] : 0) * 2.5;
    targetZ = s.drive[1] * s.driveSpeed + (steering ? dz - s.drive[1] : 0) * 2.5;
  }
  if (s.wallRunning && wall) {
    const along = wall.axis === 0 ? 2 : 0,
      sign = Math.sign((along === 2 ? dz : dx) || s.v[along]) || 1;
    const speed = Math.max(M.wallSpeed, s.boost > 0 ? M.runSpeed * 1.45 : 0);
    targetX = wall.axis === 0 ? 0 : sign * speed;
    targetZ = wall.axis === 2 ? 0 : sign * speed;
    acceleration = 18;
    s.wallTime += dt;
    s.p[wall.axis] =
      wall.platform.p[wall.axis] + wall.side * (wall.platform.size[wall.axis] / 2 + 0.34);
    s.wallRise = Math.max(0, s.wallRise - M.gravity * dt * 1.5);
    s.v[1] = s.wallRise > 0 ? s.wallRise : -M.wallDescent - s.wallTime * 0.35;
    s.message = 'WALL RUN';
  } else s.v[1] -= M.gravity * dt;
  s.v[0] += (targetX - s.v[0]) * Math.min(1, dt * acceleration);
  s.v[2] += (targetZ - s.v[2]) * Math.min(1, dt * acceleration);
  const previous: Vec3 = [...s.p],
    next = s.p.map((n, i) => n + s.v[i] * dt) as Vec3;
  const handContact = diveHandContact(s, course, previous, next);
  if (handContact) {
    s.p = handContact.root;
    s.diveFloor = handContact.floor;
    const pull = pullOverBeam(s, course, handContact.index, handContact.point);
    if (pull) {
      startPull(s, pull);
      pose(s, 'vault', dt);
      advanceCourse(s, course);
      return;
    }
    s.p = previous;
  }
  const landingFloor = floorAt(s, course, next);
  s.rollReady =
    s.rollBuffer > 0 &&
    !s.grounded &&
    !s.diving &&
    !s.wallRunning &&
    s.crashTime <= 0 &&
    s.v[1] <= 0 &&
    landingFloor !== undefined &&
    s.p[1] - landingFloor >= -0.12 &&
    s.p[1] - landingFloor <= M.rollPrepHeight;
  const height = s.diving || s.rolling > 0 || s.rollReady || s.crashTime > 0 ? 0.8 : 1.8;
  let grounded = false,
    landedOn = -1;
  for (let i = 0; i < course.platforms.length; i++) {
    const p = course.platforms[i],
      top = platformTop(p, i, s),
      bottom = top - p.size[1];
    const insideX = Math.abs(next[0] - p.p[0]) < p.size[0] / 2 + 0.28,
      insideZ = Math.abs(next[2] - p.p[2]) < p.size[2] / 2 + 0.28;
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
      landedOn = i;
      if (p.kind === 'hinge' && s.hinges[i] === undefined) s.hinges[i] = s.time;
    } else if (insideX && insideZ && next[1] < top - 0.1 && next[1] + height > bottom + 0.05) {
      // Arms guide the contextual dive over its target's near lip during ascent.
      if (s.diving && s.diveObstacle === i && s.v[1] > 0) continue;
      const wasX = Math.abs(previous[0] - p.p[0]) >= p.size[0] / 2 + 0.27,
        wasZ = Math.abs(previous[2] - p.p[2]) >= p.size[2] / 2 + 0.27;
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
  const justLanded = grounded && !s.grounded;
  s.grounded = grounded;
  s.p = next;
  if (justLanded) {
    if (s.diving) {
      const beam = course.platforms[landedOn];
      const floor = lowBeamFloor(s, course, landedOn);
      const eligible = floor !== undefined;
      if (eligible) s.diveFloor = floor;
      const farEnough = eligible && beamProgress(s.p, s.drive, beam) >= 0.25 - 1e-6;
      const pull = farEnough ? pullOverBeam(s, course, landedOn) : null;
      if (pull) {
        startPull(s, pull);
        pose(s, 'vault', dt);
        advanceCourse(s, course);
        return;
      }
      crash(s, eligible ? 'SHORT VAULT · BEFORE FIRST QUARTER' : 'DIVE CRASH · MOMENTUM LOST');
    } else if (s.trickActive) {
      if (s.trickTime + 1e-6 >= M.trickDuration) {
        s.boost = 1.15;
        s.message = 'CLEAN LANDING + BOOST';
      } else {
        s.recovery = 0.35;
        s.v[0] *= 0.72;
        s.v[2] *= 0.72;
        s.message = 'TRICK TOO LATE · RECOVERING';
      }
    }
    s.trickActive = false;
    s.trickTime = 0;
    s.trickUsed = false;
    s.airJumped = false;
  }
  startRoll(s, direction, course);
  pose(
    s,
    s.grounded
      ? s.crashTime > 0
        ? 'crash'
        : s.rolling > 0
          ? 'roll'
          : Math.hypot(s.v[0], s.v[2]) > 0.5
            ? 'run'
            : 'idle'
      : s.wallRunning
        ? 'wallrun'
        : s.diving
          ? 'dive'
          : s.rollReady
            ? 'roll-ready'
            : s.trickActive
              ? s.trick
              : s.v[1] > 0
                ? 'jump'
                : 'fall',
    dt,
  );
  advanceCourse(s, course);
}
