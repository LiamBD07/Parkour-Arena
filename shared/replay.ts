import type { Course, GhostFrame, Vec3 } from './game.js';
import { simulateGuide } from './guide.js';

export function interpolateReplay(frames: GhostFrame[], t: number): GhostFrame | null {
  if (!frames.length) return null;
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = frames[lo],
    b = frames[Math.min(lo + 1, frames.length - 1)];
  const k = b.t === a.t ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  return {
    t,
    p: a.p.map((v, i) => v + (b.p[i] - v) * k) as Vec3,
    yaw: a.yaw + (b.yaw - a.yaw) * k,
    pose: a.pose,
    phase:
      a.phase !== undefined
        ? b.pose === a.pose && b.phase !== undefined
          ? a.phase + (b.phase - a.phase) * k
          : a.phase
        : undefined,
    wallSide: a.wallSide,
  };
}

// Bots are explicitly labelled synthetic rivals; they never populate the public leaderboard.
const guideCache = new Map<string, GhostFrame[]>();
export function botReplay(course: Course, duration = 32000, _seed = 0): GhostFrame[] {
  const key = `${course.id}:${course.version}`;
  let source = guideCache.get(key);
  if (!source) {
    const guide = simulateGuide(course);
    if (!guide.state.finished || guide.state.falls)
      throw new Error('Practice route is incomplete.');
    source = guide.frames;
    guideCache.set(key, source);
  }
  const elapsed = source.at(-1)!.t;
  const frames: GhostFrame[] = [];
  for (let t = 0; t < duration; t += 100) {
    const frame = interpolateReplay(source, (t / duration) * elapsed)!;
    frames.push({ ...frame, t });
  }
  frames.push({ ...source.at(-1)!, t: duration });
  return frames;
}
