import type { Course, GhostFrame, Vec3 } from './game.js';

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
export function botReplay(course: Course, duration = 32000, seed = 0): GhostFrame[] {
  const platforms = course.platforms.filter((p) => !p.kind || p.kind === 'hinge');
  const points: Vec3[] = [
    course.start,
    ...platforms.slice(1).map((p) => [p.p[0], p.p[1] + p.size[1] / 2, p.p[2]] as Vec3),
    course.checkpoints.at(-1)!.p,
  ];
  const frames: GhostFrame[] = [];
  for (let t = 0; t <= duration; t += 100) {
    const progress = Math.min(1, t / duration);
    const totalZ = points.at(-1)![2] - points[0][2];
    const z = points[0][2] + progress * totalZ;
    let idx = 0;
    while (idx < points.length - 2 && points[idx + 1][2] < z) idx++;
    const a = points[idx],
      b = points[idx + 1];
    const k = Math.max(0, Math.min(1, (z - a[2]) / Math.max(0.1, b[2] - a[2])));
    const arc = Math.sin(k * Math.PI) * (idx > 0 ? 2.6 : 1.6);
    frames.push({
      t,
      p: [
        a[0] + (b[0] - a[0]) * k + Math.sin(progress * 12 + seed) * 0.35,
        a[1] + (b[1] - a[1]) * k + arc,
        z,
      ],
      yaw: Math.atan2(b[0] - a[0], b[2] - a[2]),
      pose: arc > 0.4 ? (k < 0.5 ? 'jump' : 'fall') : 'run',
    });
  }
  return frames;
}
