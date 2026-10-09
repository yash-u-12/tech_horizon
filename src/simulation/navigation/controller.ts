/**
 * MOVEMENT CONTROLLER
 *
 * Converts a planned route into wheel-level commands for a differential-drive
 * AMR using pure-pursuit path tracking with a kinematic limiter. The output is
 * a normalised (v, ω) command — it does NOT move anything. Which body executes
 * it is decided by the robot's execution backend (sim or physical).
 */

import type { PathPoint, RobotState, Vec2 } from '../types';
import { angleDelta, clamp, dist } from '../core/math';

export interface MotionCommand {
  v: number;
  w: number;
  /** true when the final waypoint has been reached */
  arrived: boolean;
  /** waypoint index the controller is steering towards */
  cursor: number;
  /** distance remaining along the plan */
  remaining: number;
  /** heading error to the lookahead point (rad) */
  alpha: number;
  why: string;
}

export interface ControlOptions {
  dt: number;
  /** hard safety brake applied by the reactive layer (0..1 multiplier) */
  safetyFactor: number;
  /** extra speed multiplier from traffic/yield logic */
  throttle: number;
  cruise: number;
  /** force the robot to rotate in place towards the next waypoint first */
  alignFirst?: boolean;
  /** nearby peers to steer around (local avoidance on top of the global plan) */
  avoid?: { x: number; y: number; vx: number; vy: number }[];
}

const ARRIVE_RADIUS = 0.35;
const WAYPOINT_RADIUS = 0.5;
/** cross-track distance that still counts as "on the leg" */
const LANE_TOLERANCE = 0.6;

export function computeMotion(state: RobotState, opts: ControlOptions): MotionCommand {
  const caps = state.capabilities;
  const plan = state.plan;

  if (!plan || plan.points.length === 0) {
    return { v: 0, w: 0, arrived: false, cursor: 0, remaining: 0, alpha: 0, why: 'NO_PLAN' };
  }

  // ── advance the waypoint cursor ───────────────────────────────────────────
  // Proximity alone is NOT enough: if the lookahead distance is shorter than
  // the robot's minimum turning radius, pure pursuit makes it ORBIT the
  // waypoint forever at a radius just outside the arrival threshold — it is
  // permanently "moving" and permanently stuck. So we advance on progress ALONG
  // the leg (projection past the waypoint), which an orbit satisfies trivially.
  let cursor = clamp(state.plan!.cursor, 0, plan.points.length - 1);
  const pts0 = plan.points;
  while (cursor < pts0.length - 1) {
    const a = pts0[cursor];
    const b = pts0[cursor + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abLen2 = abx * abx + aby * aby;
    if (abLen2 < 1e-9) {
      cursor++;
      continue;
    }
    const apx = state.pose.x - a.x;
    const apy = state.pose.y - a.y;
    const t = (apx * abx + apy * aby) / abLen2;
    const crossTrack = Math.abs(apx * aby - apy * abx) / Math.sqrt(abLen2);
    const near = Math.hypot(apx, apy) < WAYPOINT_RADIUS;
    const passed = t > 1 || (t >= 0 && crossTrack < LANE_TOLERANCE);
    if (near || passed) cursor++;
    else break;
  }
  plan.cursor = cursor;

  const pts = plan.points;
  const last = pts[pts.length - 1];
  const distToGoal = dist(state.pose.x, state.pose.y, last.x, last.y);

  if (distToGoal < ARRIVE_RADIUS && cursor >= pts.length - 1) {
    return { v: 0, w: 0, arrived: true, cursor, remaining: 0, alpha: 0, why: 'ARRIVED' };
  }

  // ── remaining length ──────────────────────────────────────────────────────
  let remaining = dist(state.pose.x, state.pose.y, pts[cursor].x, pts[cursor].y);
  for (let i = cursor; i < pts.length - 1; i++) remaining += dist(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);

  // ── lookahead point ───────────────────────────────────────────────────────
  // Lookahead must exceed the minimum turning radius (v / ωmax), otherwise the
  // robot orbits its own lookahead point instead of converging on the route.
  const minTurnRadius = caps.maxOmega > 0 ? Math.abs(state.speed) / caps.maxOmega : 0;
  const Ld = clamp(Math.max(0.75, 2.2 * minTurnRadius) + 0.55 * Math.abs(state.speed), 0.8, 3.0);
  const look = lookaheadPoint(state.pose, pts, cursor, Ld, distToGoal);

  const desired = Math.atan2(look.y - state.pose.y, look.x - state.pose.x);
  const alpha = angleDelta(state.pose.theta, desired);

  // ── speed profile ─────────────────────────────────────────────────────────
  let v = opts.cruise;
  // slow into turns
  v *= clamp(1 - Math.abs(alpha) / 1.35, 0.1, 1);
  // decelerate into the goal so we can stop accurately
  const stopDist = (state.speed * state.speed) / (2 * Math.max(0.2, caps.maxAccel));
  if (distToGoal < Math.max(stopDist, 0.35)) v *= clamp(distToGoal / Math.max(stopDist, 0.35), 0.05, 1);
  if (distToGoal < 0.5) v = Math.min(v, 0.35);
  // traffic & safety
  v *= opts.throttle * opts.safetyFactor;
  // kinematic curvature limit: |ω| ≤ ωmax  ⇒  v ≤ ωmax / |κ|
  const kappa = (2 * Math.sin(alpha)) / Math.max(0.25, Ld);
  const vCurv = Math.abs(kappa) > 1e-4 ? caps.maxOmega / Math.abs(kappa) : Infinity;
  v = Math.min(v, vCurv, caps.maxVelocity);

  let w = kappa * v;

  // ── local avoidance ───────────────────────────────────────────────────────
  // Planning alone cannot resolve a head-on meeting inside a 2.5 m aisle: both
  // robots want the same centreline. This steering term biases each robot
  // towards its own side so they can pass, which is what a real fleet does.
  for (const p of opts.avoid ?? []) {
    const dx = p.x - state.pose.x;
    const dy = p.y - state.pose.y;
    const d = Math.hypot(dx, dy);
    if (d > 3.0 || d < 1e-3) continue;
    const fwd = dx * Math.cos(state.pose.theta) + dy * Math.sin(state.pose.theta);
    if (fwd < -0.4) continue;
    const lat = dx * -Math.sin(state.pose.theta) + dy * Math.cos(state.pose.theta);
    // Only nudge, never fight the planner: a strong bias turns into a limit
    // cycle where the robot spins in place instead of making progress.
    const urgency = clamp((2.2 - d) / 2.2, 0, 1) * clamp(1.2 - Math.abs(lat), 0, 1);
    w += (lat > 0 ? -1 : 1) * urgency * 0.55;
    v *= clamp(0.45 + 0.55 * (d / 2.4), 0.4, 1);
  }

  w = clamp(w, -caps.maxOmega, caps.maxOmega);

  // rotate-in-place when badly misaligned (tight aisle behaviour)
  if (Math.abs(alpha) > 1.15) {
    v = Math.min(v, 0.12);
    w = clamp(alpha * 2.2, -caps.maxOmega, caps.maxOmega);
  }

  v = Math.max(0, v);

  return { v, w, arrived: false, cursor, remaining, alpha, why: 'FOLLOWING' };
}

function lookaheadPoint(pose: Vec2, pts: PathPoint[], cursor: number, Ld: number, distToGoal: number) {
  if (distToGoal <= Ld) return pts[pts.length - 1];
  let acc = dist(pose.x, pose.y, pts[cursor].x, pts[cursor].y);
  let i = cursor;
  while (i < pts.length - 1 && acc < Ld) {
    acc += dist(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    i++;
  }
  return pts[Math.min(i, pts.length - 1)];
}

/**
 * Integrate a differential-drive body one step with acceleration limits.
 * Used by SimulationBackend. The PhysicalBackend instead reports telemetry.
 */
export function integrateBody(
  pose: { x: number; y: number; theta: number },
  v: number,
  w: number,
  prevV: number,
  dt: number,
  caps: RobotState['capabilities'],
  bounds: { w: number; h: number },
  /** Optional drivability test; when supplied the body cannot enter structure. */
  isDrivable?: (x: number, y: number) => boolean,
): { x: number; y: number; theta: number; v: number; vx: number; vy: number; accel: number; blocked: boolean } {
  const dv = clamp(v - prevV, -caps.maxAccel * dt, caps.maxAccel * dt);
  const nv = clamp(prevV + dv, -caps.maxVelocity * 0.35, caps.maxVelocity);
  const nw = clamp(w, -caps.maxOmega, caps.maxOmega);
  const ntheta = pose.theta + nw * dt;
  const m = caps.footprint * 0.6;

  let nx = pose.x + Math.cos(ntheta) * nv * dt;
  let ny = pose.y + Math.sin(ntheta) * nv * dt;
  nx = clamp(nx, m, bounds.w - m);
  ny = clamp(ny, m, bounds.h - m);

  let blocked = false;
  if (isDrivable && !isDrivable(nx, ny)) {
    // Wall sliding: try each axis independently before giving up. This keeps a
    // robot moving along a rack face instead of welding itself to it, and it
    // guarantees a simulated body can never occupy structure.
    blocked = true;
    const tryX = isDrivable(nx, pose.y);
    const tryY = isDrivable(pose.x, ny);
    if (tryX && !tryY) ny = pose.y;
    else if (tryY && !tryX) nx = pose.x;
    else {
      nx = pose.x;
      ny = pose.y;
    }
  }

  return {
    x: nx,
    y: ny,
    theta: ntheta,
    v: nv,
    vx: Math.cos(ntheta) * nv,
    vy: Math.sin(ntheta) * nv,
    accel: dv / Math.max(dt, 1e-6),
    blocked,
  };
}
