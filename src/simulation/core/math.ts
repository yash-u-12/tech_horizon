export const TAU = Math.PI * 2;
export const SQRT2 = Math.SQRT2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

export const dist = (ax: number, ay: number, bx: number, by: number) => Math.sqrt(dist2(ax, ay, bx, by));

/** Shortest signed angular difference, result in (-PI, PI]. */
export function angleDelta(from: number, to: number) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function wrapAngle(a: number) {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x <= -Math.PI) x += TAU;
  return x;
}

export function moveTowards(current: number, target: number, maxDelta: number) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/**
 * Time to closest approach for two moving point masses, with closest distance.
 * Returns { ttc, cpa } where ttc is Infinity if they are separating.
 */
export function computeCPOA(
  ax: number, ay: number, avx: number, avy: number,
  bx: number, by: number, bvx: number, bvy: number,
): { ttc: number; cpa: number } {
  const rx = bx - ax;
  const ry = by - ay;
  const rvx = bvx - avx;
  const rvy = bvy - avy;
  const rv2 = rvx * rvx + rvy * rvy;
  if (rv2 < 1e-6) return { ttc: Infinity, cpa: Math.hypot(rx, ry) };
  const t = -(rx * rvx + ry * rvy) / rv2;
  if (t <= 0) return { ttc: Infinity, cpa: Math.hypot(rx, ry) };
  const cx = rx + rvx * t;
  const cy = ry + rvy * t;
  return { ttc: t, cpa: Math.hypot(cx, cy) };
}

export function polyLength(pts: { x: number; y: number }[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
  return L;
}

/** Chaikin smoothing — turns a jagged grid path into a drivable AMR route. */
export function smoothPath(pts: { x: number; y: number }[], iterations = 2): { x: number; y: number }[] {
  let cur = pts;
  for (let k = 0; k < iterations; k++) {
    if (cur.length < 3) return cur;
    const out: { x: number; y: number }[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i];
      const q = cur[i + 1];
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
      out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

/** Remove nearly-collinear points to keep the rendered route clean. */
export function simplifyPath(pts: { x: number; y: number }[], eps = 0.12): { x: number; y: number }[] {
  if (pts.length <= 2) return pts;
  const out: { x: number; y: number }[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const seg = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    if (cross / seg > eps) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function mean(xs: number[]) {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function ema(prev: number, next: number, alpha: number) {
  return prev + alpha * (next - prev);
}
