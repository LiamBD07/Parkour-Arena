import type { ClassId, Course, Platform, Pose, Vec3 } from '../../shared/game';

export interface Input {
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  flip: boolean;
  dive: boolean;
  ability: boolean;
  wall: boolean;
  yaw: number;
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
  falls: number;
  coyote: number;
  jumpBuffer: number;
  hinges: Record<number, number>;
  message: string;
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
    falls: 0,
    coyote: 0.1,
    jumpBuffer: 0,
    hinges: {},
    message: '',
  };
}
export function platformTop(platform: Platform, index: number, s: RunnerState) {
  const triggered = s.hinges[index];
  const drop =
    triggered !== undefined ? Math.min(30, Math.max(0, s.time - triggered - 1.05) ** 2 * 10) : 0;
  return platform.p[1] + platform.size[1] / 2 - drop;
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
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.boost = Math.max(0, s.boost - dt);
  s.recovery = Math.max(0, s.recovery - dt);
  s.message = '';
  if (s.grounded) s.coyote = 0.11;
  else s.coyote = Math.max(0, s.coyote - dt);
  s.jumpBuffer = input.jump ? 0.12 : Math.max(0, s.jumpBuffer - dt);
  let nearWall: Platform | undefined;
  for (const p of course.platforms)
    if (
      p.kind === 'wall' &&
      Math.abs(s.p[0] - p.p[0]) < p.size[0] / 2 + 1.3 &&
      Math.abs(s.p[2] - p.p[2]) < p.size[2] / 2 + 0.3 &&
      s.p[1] < p.p[1] + p.size[1] / 2
    )
      nearWall = p;
  s.wallRunning = Boolean(!s.grounded && nearWall && input.wall && input.forward > 0);
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
    if (classId === 'traceur' && nearWall) {
      s.v[1] = 11;
      s.v[0] = Math.sign(s.p[0] - nearWall.p[0]) * 7;
      s.cooldown = 10;
      s.message = 'WALL KICK';
    }
  }
  if (s.jumpBuffer > 0 && (s.coyote > 0 || s.wallRunning)) {
    s.v[1] = 9.8;
    s.grounded = false;
    s.coyote = 0;
    s.jumpBuffer = 0;
    if (s.wallRunning && nearWall) s.v[0] = Math.sign(s.p[0] - nearWall.p[0]) * 7;
  }
  if (input.flip && !s.grounded && !s.flipStarted) {
    s.flipStarted = true;
    s.flipTime = 0;
  }
  if (s.flipStarted) s.flipTime += dt;
  if (input.dive && !s.grounded && s.pose !== 'dive') {
    s.pose = 'dive';
    s.v[1] = Math.min(0, s.v[1]);
    s.boost = 0.45;
  }
  let speed = input.sprint ? 11.8 : 8.8;
  if (s.boost > 0) speed *= 1.45;
  if (s.recovery > 0) speed *= 0.55;
  if (input.crouch && s.grounded) speed *= input.sprint ? 1.08 : 0.55;
  const length = Math.hypot(input.forward, input.right) || 1;
  const forward = input.forward / length,
    right = input.right / length;
  const targetX = (Math.sin(input.yaw) * forward - Math.cos(input.yaw) * right) * speed;
  const targetZ = (Math.cos(input.yaw) * forward + Math.sin(input.yaw) * right) * speed;
  const acceleration = s.grounded ? 13 : 4.5;
  s.v[0] += (targetX - s.v[0]) * Math.min(1, dt * acceleration);
  s.v[2] += (targetZ - s.v[2]) * Math.min(1, dt * acceleration);
  s.v[1] -= (s.pose === 'dive' ? 32 : 24) * dt;
  if (s.wallRunning) {
    s.v[1] = Math.max(-1.2, s.v[1]);
    s.message = 'WALL RUN';
  }
  const prev = [...s.p];
  const next = s.p.map((v, i) => v + s.v[i] * dt) as Vec3;
  const height = input.crouch || s.pose === 'dive' ? 0.8 : 1.8;
  let grounded = false;
  for (let i = 0; i < course.platforms.length; i++) {
    const p = course.platforms[i],
      top = platformTop(p, i, s),
      bottom = top - p.size[1];
    const insideX = Math.abs(next[0] - p.p[0]) < p.size[0] / 2 + 0.28;
    const insideZ = Math.abs(next[2] - p.p[2]) < p.size[2] / 2 + 0.28;
    const carriedByHinge =
      p.kind === 'hinge' &&
      s.grounded &&
      Math.abs(prev[1] - platformTop(p, i, { ...s, time: s.time - dt })) < 0.12;
    if (
      insideX &&
      insideZ &&
      ((prev[1] >= top - 0.12 && next[1] <= top && s.v[1] <= 0) || carriedByHinge)
    ) {
      next[1] = top;
      s.v[1] = 0;
      grounded = true;
      if (p.kind === 'hinge' && s.hinges[i] === undefined) s.hinges[i] = s.time;
    } else if (insideX && insideZ && next[1] < top - 0.1 && next[1] + height > bottom + 0.05) {
      const wasX = Math.abs(prev[0] - p.p[0]) >= p.size[0] / 2 + 0.27;
      const wasZ = Math.abs(prev[2] - p.p[2]) >= p.size[2] / 2 + 0.27;
      if (wasX) {
        next[0] = prev[0];
        s.v[0] = 0;
      }
      if (wasZ) {
        next[2] = prev[2];
        s.v[2] = 0;
      }
      if (!wasX && !wasZ && prev[1] + height <= bottom + 0.15) {
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
        s.recovery = 0.7;
        s.message = 'SHORT FLIP · RECOVERING';
      }
    }
    s.flipStarted = false;
    s.flipTime = 0;
    if (s.pose === 'dive') {
      s.boost = 0.45;
      s.message = 'DIVE ROLL';
    }
  }
  s.grounded = grounded;
  s.p = next;
  if (grounded) s.pose = input.crouch ? 'slide' : Math.hypot(s.v[0], s.v[2]) > 0.5 ? 'run' : 'idle';
  else if (s.flipStarted) s.pose = 'flip';
  else if (s.pose !== 'dive') s.pose = 'run';
  const cp = course.checkpoints[s.checkpoint + 1];
  if (
    cp &&
    Math.abs(s.p[2] - cp.p[2]) < 4 &&
    Math.abs(s.p[0] - cp.p[0]) < 8 &&
    Math.abs(s.p[1] - cp.p[1]) < 4
  ) {
    s.checkpoint++;
    s.message = s.checkpoint === course.checkpoints.length - 1 ? 'FINISH' : 'CHECKPOINT';
    if (s.checkpoint === course.checkpoints.length - 1) s.finished = true;
  }
  for (const k of Object.keys(s.hinges))
    if (s.time - s.hinges[Number(k)] > 5) delete s.hinges[Number(k)];
  if (s.p[1] < -13) {
    s.p = [...course.checkpoints[s.checkpoint].p];
    s.v = [0, 0, 0];
    s.grounded = true;
    s.pose = 'idle';
    s.flipStarted = false;
    s.recovery = 0.4;
    s.falls++;
    s.hinges = {};
    s.message = 'BACK ON YOUR FEET';
  }
}
