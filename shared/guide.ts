import type { Course, GhostFrame, Vec3 } from './game';
import { createRunner, stepRunner, motionPhase, type Input } from './physics';
import { MOVEMENT as M } from './movement';
export interface GuideResult {
  state: ReturnType<typeof createRunner>;
  frames: GhostFrame[];
  wallSections: Set<number>;
}
const idle: Input = { forward: 0, right: 0, jump: false, roll: false, ability: false, yaw: 0 };
/** Practice opponent: chooses ordinary controls, with no position or velocity corrections. */
export function simulateGuide(course: Course): GuideResult {
  const s = createRunner(course),
    frames: GhostFrame[] = [{ t: 0, p: [...s.p], yaw: 0, pose: s.pose }],
    walls = new Set<number>();
  const roofs = course.platforms.filter((p) => !p.kind || p.kind === 'hinge');
  const first = course.wallSections[0],
    second = course.wallSections[1];
  if (!first || !second) return { state: s, frames, wallSections: walls };
  const lane = (wallIndex: number, fromIndex: number) => {
    const w = course.platforms[wallIndex],
      r = course.platforms[fromIndex];
    return w.p[0] + Math.sign(r.p[0] - w.p[0]) * (w.size[0] / 2 + 0.34);
  };
  const w1 = course.platforms[first.wall],
    w2 = course.platforms[second.wall];
  const r1 = course.platforms[first.to],
    r2 = course.platforms[second.from],
    r3 = course.platforms[second.to];
  const x1 = lane(first.wall, first.from),
    x2 = lane(second.wall, second.from);
  const beam = course.platforms.find(
    (p) => p.kind === 'obstacle' && p.p[1] - p.size[1] / 2 > r2.p[1] + r2.size[1] / 2 + 0.8,
  )!;
  let stage = 0;
  for (let tick = 1; tick <= 12000 && !s.finished; tick++) {
    let target: Vec3 = [s.p[0], s.p[1], s.p[2] + 8],
      jump = false,
      roll = false;
    if (stage === 0) {
      target = [x1, 4, w1.p[2] - w1.size[2] / 2 + 0.3];
      if (Math.abs(s.p[0] - x1) < 0.7 && s.p[2] > target[2] - 0.6) stage = 1;
    }
    if (stage === 1) {
      target = [x1, 5, r1.p[2] - r1.size[2] / 2 - 7];
      jump = s.grounded;
      if (s.wallRunning) walls.add(0);
      if (s.p[2] >= target[2] - 0.1) {
        stage = 2;
        jump = true;
      }
    } else if (stage === 2) {
      target = [r1.p[0] - 5, 4, r1.p[2] + r1.size[2] / 2 - 1];
      if (s.grounded && s.p[2] > r1.p[2] - r1.size[2] / 2) {
        stage = 3;
      }
    }
    if (stage === 3) {
      target = [beam.p[0] - 4, 5, beam.p[2] - 5];
      jump =
        s.grounded && s.p[2] > r1.p[2] + r1.size[2] / 2 - 1.4 && s.p[2] < r2.p[2] - r2.size[2] / 2;
      if (s.grounded && s.p[2] > r2.p[2] - r2.size[2] / 2 + 4) stage = 4;
    }
    if (stage === 4) {
      target = [beam.p[0] - 4, 5, beam.p[2] + 3];
      roll =
        s.grounded &&
        s.p[2] > beam.p[2] - 5.5 &&
        s.p[2] < beam.p[2] &&
        s.rolling <= 0 &&
        s.maneuverCooldown <= 0;
      if (s.p[2] > beam.p[2] + beam.size[2] / 2 + 0.6) stage = 5;
    }
    if (stage === 5) {
      target = [x2, 5, w2.p[2] - w2.size[2] / 2 + 0.9];
      if (Math.abs(s.p[0] - x2) < 0.65 && s.p[2] > target[2] - 0.65) stage = 6;
    }
    if (stage === 6) {
      target = [x2, 6, r3.p[2] - r3.size[2] / 2 - 7];
      jump = s.grounded;
      if (s.wallRunning) walls.add(1);
      if (s.p[2] >= target[2] - 0.1) {
        stage = 7;
        jump = true;
      }
    } else if (stage === 7) {
      target = [r3.p[0] + 4, 5, r3.p[2] + 3];
      if (s.grounded && s.p[2] > r3.p[2] - r3.size[2] / 2) stage = 8;
    }
    if (stage === 8) {
      const z = s.p[2];
      let index = roofs.findIndex(
        (p) => z >= p.p[2] - p.size[2] / 2 - 0.1 && z <= p.p[2] + p.size[2] / 2 + 0.1,
      );
      if (index < 0) index = Math.max(0, roofs.findIndex((p) => p.p[2] > z) - 1);
      const roof = roofs[index],
        next = roofs[Math.min(index + 1, roofs.length - 1)];
      const blend = Math.max(0, Math.min(1, (z - (roof.p[2] + roof.size[2] / 2 - 7)) / 12));
      let x = roof.p[0] + (next.p[0] - roof.p[0]) * blend;
      const box = course.platforms.find(
        (p) =>
          p.kind === 'obstacle' &&
          p.p[1] - p.size[1] / 2 <= roof.p[1] + roof.size[1] / 2 + 0.2 &&
          z < p.p[2] + p.size[2] / 2 + 1 &&
          z > p.p[2] - 8,
      );
      if (box) x = box.p[0] + (s.p[0] >= box.p[0] ? 1 : -1) * (box.size[0] / 2 + 1);
      target = [x, s.p[1], s.p[2] + 4];
      jump = s.grounded && z > roof.p[2] + roof.size[2] / 2 - 1.4 && index < roofs.length - 1;
    }
    const dx = target[0] - s.p[0],
      dz = target[2] - s.p[2],
      distance = Math.hypot(dx, dz) || 1;
    const input = { ...idle, forward: dz / distance, right: -dx / distance, jump, roll };
    stepRunner(s, input, course, 'runner', M.step, () => 0);
    if (tick % 12 === 0 || s.finished)
      frames.push({
        t: Math.round(s.time * 1000),
        p: [...s.p],
        yaw: 0,
        pose: s.pose,
        phase: motionPhase(s),
        wallSide: s.wallSide,
      });
    if (s.falls > 0) break;
  }
  return { state: s, frames, wallSections: walls };
}
