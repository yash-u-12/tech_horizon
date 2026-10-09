/**
 * COLLISION / TRAFFIC LAYER
 *
 * Two independent mechanisms, both DECENTRALISED:
 *
 *  1. Predictive conflict detection — each agent runs `predictConflicts` on its
 *     OWN perception and computes time-to-closest-approach for the peers it can
 *     actually see/hear. Two agents will often disagree, because they perceive
 *     different things. That is intended.
 *
 *  2. Peer-to-peer right-of-way — `rightOfWay(a, b)` is a pure, symmetric,
 *     deterministic function of information both agents broadcast. There is no
 *     arbiter: each robot evaluates it locally and reaches the same verdict,
 *     so one yields and the other proceeds without any message being sent.
 *
 *  3. Reactive safety brake — a hard stop that does not consult planning at all.
 *     It always wins.
 */

import type { ConflictRisk, DetectedRobot, RobotState, TaskPriority } from '../types';
import { clamp, computeCPOA, dist } from '../core/math';
import type { Rng } from '../core/rng';

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  CRITICAL: 40,
  HIGH: 30,
  NORMAL: 20,
  LOW: 10,
};

export interface SelfSnapshot {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  carrying: boolean;
  taskPriority: TaskPriority | null;
  battery: number;
  chargingIntent: boolean;
  /** assertiveness trait shifts hesitation, never right-of-way */
  assertiveness: number;
}

/**
 * > 0 : A has right of way
 * < 0 : B has right of way
 * = 0 : deterministic tie-break by id (stable, symmetric, no central referee)
 */
export function rightOfWay(a: SelfSnapshot, b: SelfSnapshot): number {
  if (a.id === b.id) return 0;
  // 1. mission criticality
  const pa = a.taskPriority ? PRIORITY_WEIGHT[a.taskPriority] : 0;
  const pb = b.taskPriority ? PRIORITY_WEIGHT[b.taskPriority] : 0;
  if (pa !== pb) return pa - pb;
  // 2. a robot carrying a package has a committed delivery — let it finish
  const ca = a.carrying ? 1 : 0;
  const cb = b.carrying ? 1 : 0;
  if (ca !== cb) return ca - cb;
  // 3. energy emergency: a robot heading to a charger on fumes is unpredictable
  const ea = a.chargingIntent && a.battery < 25 ? 1 : 0;
  const eb = b.chargingIntent && b.battery < 25 ? 1 : 0;
  if (ea !== eb) return ea - eb;
  // 4. deterministic symmetric tie-break: lexicographic id. Both sides agree.
  return a.id < b.id ? 1 : -1;
}

export interface PredictOptions {
  horizon: number; // seconds
  safetyRadius: number;
  /** how far ahead the agent bothers to look, metres */
  range: number;
}

/**
 * Each agent calls this with only the peers it perceives. Returns the conflicts
 * THIS agent believes exist for itself.
 */
export function predictConflicts(
  self: SelfSnapshot,
  peers: DetectedRobot[],
  opts: PredictOptions,
  time: number,
  rng: Rng,
): ConflictRisk[] {
  const out: ConflictRisk[] = [];
  for (const p of peers) {
    if (p.distance > opts.range) continue;
    const { ttc, cpa } = computeCPOA(self.x, self.y, self.vx, self.vy, p.x, p.y, p.vx * 0.9, p.vy * 0.9);
    if (!Number.isFinite(ttc) || ttc > opts.horizon) continue;
    if (cpa > opts.safetyRadius * 2.4) continue;

    const severity =
      cpa < opts.safetyRadius * 0.9 || ttc < 1.2 ? 'CRITICAL' :
      cpa < opts.safetyRadius * 1.4 || ttc < 2.2 ? 'HIGH' :
      ttc < 3.5 ? 'MEDIUM' : 'LOW';

    out.push({
      id: `CF-${self.id}-${p.id}-${Math.floor(time * 10)}`,
      a: self.id,
      b: p.id,
      ttc,
      cpa,
      distance: p.distance,
      severity,
      at: { x: (self.x + p.x) / 2, y: (self.y + p.y) / 2 },
      resolved: false,
    });
  }
  return out.sort((a, b) => a.ttc - b.ttc);
}

/** Ground-truth near-miss scan used by the engine's traffic telemetry. */
export function scanNearMisses(robots: RobotState[], threshold: number): { a: string; b: string; d: number }[] {
  const out: { a: string; b: string; d: number }[] = [];
  for (let i = 0; i < robots.length; i++) {
    for (let j = i + 1; j < robots.length; j++) {
      const A = robots[i];
      const B = robots[j];
      if (A.status === 'OFFLINE' || B.status === 'OFFLINE') continue;
      const d = dist(A.pose.x, A.pose.y, B.pose.x, B.pose.y);
      if (d < threshold) out.push({ a: A.id, b: B.id, d });
    }
  }
  return out;
}

/**
 * Reactive safety brake. Independent of any plan — pure geometry.
 * Returns 0..1 multiplier on commanded velocity, plus a hard-stop flag.
 */
export function safetyBrake(
  self: RobotState,
  peers: DetectedRobot[],
  obstacles: { x: number; y: number; r: number }[],
): { factor: number; hardStop: boolean; reason?: string } {
  const hardDist = self.capabilities.footprint * 1.05 + 0.18;
  const softDist = self.capabilities.footprint * 2.1 + 0.55;
  const fx = Math.cos(self.pose.theta);
  const fy = Math.sin(self.pose.theta);

  for (const p of peers) {
    const dx = p.x - self.pose.x;
    const dy = p.y - self.pose.y;
    const d = Math.hypot(dx, dy);
    // Lateral offset matters: two AMRs passing side by side in a 2.5 m aisle
    // are legitimately close but not in danger. Only a peer actually in my
    // lane forces a stop.
    const lat = Math.abs(dx * -fy + dy * fx);
    if (d < hardDist && lat < 0.78) return { factor: 0, hardStop: true, reason: `PROXIMITY ${p.id}` };
  }
  for (const o of obstacles) {
    const d = dist(self.pose.x, self.pose.y, o.x, o.y) - o.r;
    if (d < hardDist * 0.6) return { factor: 0, hardStop: true, reason: 'STATIC PROXIMITY' };
  }

  let factor = 1;
  for (const p of peers) {
    const dx = p.x - self.pose.x;
    const dy = p.y - self.pose.y;
    const d = Math.hypot(dx, dy);
    if (d > softDist) continue;
    const lat = Math.abs(dx * -fy + dy * fx);
    const ahead = dx * fx + dy * fy;
    if (ahead <= 0) {
      factor = Math.min(factor, 0.75); // behind me: only mild caution
      continue;
    }
    const closing = dx * self.vx + dy * self.vy;
    const room = clamp(lat / 0.85, 0, 1);
    const f = 0.2 + 0.6 * room;
    factor = Math.min(factor, closing > 0 ? f : Math.min(1, f + 0.4));
  }
  return { factor, hardStop: false };
}

/**
 * Deadlock breaker. In a decentralised system two robots can both yield (if
 * comms dropped a message) or both proceed. This is resolved locally with a
 * timer plus a deterministic jitter derived from the agent's own id, so the
 * fleet always recovers without a supervisor.
 */
export function deadlockBreaker(self: RobotState, heldFor: number, rng: Rng): 'KEEP_WAITING' | 'PROCEED' | 'REROUTE' {
  const patience = 1.6 + self.memory.traits.assertiveness * 2.4;
  if (heldFor < patience) return 'KEEP_WAITING';
  // after patience expires, whoever is more assertive pushes through; the other
  // one detours. Deterministic given both agents' traits.
  if (self.memory.traits.assertiveness >= 0.5) return 'PROCEED';
  return rng() < 0.6 ? 'REROUTE' : 'PROCEED';
}
