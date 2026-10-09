/**
 * CONTEXT CONSTRUCTION
 *
 *   environment truth ─┐
 *   own state         ─┼──▶ RobotContext (subjective, per-agent)
 *   own perception    ─┘
 *
 * This function is called once per agent per tick. It never mutates shared
 * state, and it never reads another agent's context. The `signature` field is a
 * numeric fingerprint so the UI can literally show that two agents standing in
 * the same aisle hold *different* models of the world.
 */

import type {
  ConflictRisk,
  RobotContext,
  RobotPerception,
  RobotState,
  Task,
  Vec2,
  ZoneKind,
} from '../types';
import type { Warehouse } from '../environment/warehouse';
import { dist } from '../core/math';

export interface ContextInputs {
  self: RobotState;
  perception: RobotPerception;
  warehouse: Warehouse;
  task: Task | null;
  conflicts: ConflictRisk[];
  time: number;
  /** comms health of this agent right now */
  comms: { connected: boolean; latencyMs: number; packetLoss: number; degraded: boolean };
  /** cruise speed used for ETA estimation */
  cruiseSpeed: number;
}

export function buildContext(input: ContextInputs): RobotContext {
  const { self, perception, warehouse, task, conflicts, time, comms, cruiseSpeed } = input;
  const pose = self.pose;

  // ── location semantics ────────────────────────────────────────────────────
  const zone = warehouse.zoneAt(pose.x, pose.y);
  const clearance = clearanceMetres(warehouse, pose);
  const inAisle = clearance <= 1.6;
  const atIntersection = clearance >= 2.1 && perception.detectedRobots.filter((r) => r.distance < 6).length >= 1;

  // ── plan state ────────────────────────────────────────────────────────────
  let planRemaining = 0;
  let planValid = false;
  if (self.plan && self.plan.points.length) {
    const startIdx = Math.min(self.plan.cursor, self.plan.points.length - 1);
    let acc = dist(pose.x, pose.y, self.plan.points[startIdx].x, self.plan.points[startIdx].y);
    for (let i = startIdx; i < self.plan.points.length - 1; i++) {
      acc += dist(self.plan.points[i].x, self.plan.points[i].y, self.plan.points[i + 1].x, self.plan.points[i + 1].y);
    }
    planRemaining = acc;
    planValid = perception.blockedPlanCells.length === 0;
  }

  // ── traffic ───────────────────────────────────────────────────────────────
  const nearby = perception.detectedRobots;
  const nearestRobotDistance = nearby.length ? nearby[0].distance : Infinity;
  const densityCount = nearby.filter((r) => r.distance < 6).length;
  const localDensity = Math.min(1, densityCount / 4);
  const headingTowardsMe = nearby.filter((r) => {
    const toMe = Math.atan2(pose.y - r.y, pose.x - r.x);
    const d = Math.abs(normalizeAngle(r.heading - toMe));
    return d < 0.9 && r.distance < 7;
  }).length;

  // ── obstacles ─────────────────────────────────────────────────────────────
  const ahead = obstacleAhead(self, perception);
  const planBlocked = perception.blockedPlanCells.length > 0;

  // ── task ──────────────────────────────────────────────────────────────────
  const dest: Vec2 | null = task
    ? task.phase === 'TO_PICK' || task.phase === 'PICKING'
      ? { x: task.from.x, y: task.from.y }
      : { x: task.to.x, y: task.to.y }
    : self.destination;
  const eta = planRemaining > 0 ? planRemaining / Math.max(0.15, cruiseSpeed) : null;
  const slaRemaining = task ? Math.max(0, task.slaSeconds - (time - task.createdAt)) : null;
  const atRisk = slaRemaining !== null && eta !== null && eta > slaRemaining;

  // ── energy ────────────────────────────────────────────────────────────────
  const charger = warehouse.nearestCharger(pose.x, pose.y);
  const distanceToNearestCharger = dist(pose.x, pose.y, charger.x, charger.y);
  const reserveMargin = self.battery / 100 - (distanceToNearestCharger / 260) * 100;
  const needsCharge = self.battery < self.memory.traits.chargeThreshold * 100;

  const summary: string[] = [];
  summary.push(`ZONE ${zone.name}`);
  summary.push(`${nearby.length} ROBOT${nearby.length === 1 ? '' : 'S'} IN ${perception.radius.toFixed(1)}m`);
  if (planBlocked) summary.push(`PLAN BLOCKED @ ${perception.blockedPlanCells.length} PTS`);
  if (ahead) summary.push(`OBSTACLE ${ahead.distance.toFixed(1)}m AHEAD`);
  if (needsCharge) summary.push(`BATTERY ${self.battery.toFixed(0)}% < THRESHOLD`);
  if (task) summary.push(`TASK ${task.id} ${task.priority} · ${task.phase}`);
  if (conflicts.length) summary.push(`${conflicts.length} PREDICTED CONFLICT(S)`);
  if (comms.degraded) summary.push('COMMS DEGRADED');
  if (!self.plan) summary.push('NO ACTIVE PLAN');

  const signature = hashContext({
    x: Math.round(pose.x * 4), y: Math.round(pose.y * 4),
    zone: zone.kind, battery: Math.round(self.battery),
    nearby: nearby.length, density: Math.round(localDensity * 10),
    blocked: perception.blockedPlanCells.length,
    task: task ? task.priority + task.phase : 'none',
    conflicts: conflicts.length,
    clearance: Math.round(clearance * 10),
  });

  return {
    robotId: self.id,
    at: time,
    self: {
      pose: { ...pose },
      speed: self.speed,
      battery: self.battery,
      payloadKg: self.payloadKg,
      status: self.status,
      navState: self.navState,
      taskId: self.taskId,
      taskPriority: self.taskPriority,
      planRemaining,
      planValid,
      carrying: self.carryingPackageId !== null,
    },
    location: {
      zoneId: zone.id,
      zoneKind: zone.kind as ZoneKind,
      inAisle,
      aisleWidth: clearance * 2,
      atIntersection,
    },
    traffic: {
      nearbyCount: nearby.length,
      nearestRobotDistance: Number.isFinite(nearestRobotDistance) ? nearestRobotDistance : -1,
      localDensity,
      predictedConflicts: conflicts,
      headingTowardsMe,
    },
    obstacles: {
      ahead,
      count: perception.detectedObstacles.length,
      planBlocked,
      blockedCells: perception.blockedPlanCells.length,
    },
    task: {
      id: task?.id ?? null,
      type: task?.type ?? null,
      priority: task?.priority ?? null,
      phase: task?.phase ?? null,
      destination: dest,
      eta,
      slaRemaining,
      atRisk,
    },
    energy: {
      battery: self.battery,
      needsCharge,
      reserveMargin,
      distanceToNearestCharger,
    },
    comms: {
      connected: comms.connected,
      latencyMs: comms.latencyMs,
      packetLoss: comms.packetLoss,
      peersHeard: nearby.map((r) => r.id),
      degraded: comms.degraded,
    },
    summary,
    signature,
  };
}

function obstacleAhead(self: RobotState, perception: RobotPerception) {
  let best: (typeof perception.detectedObstacles)[number] | null = null;
  for (const o of perception.detectedObstacles) {
    const toO = Math.atan2(o.y - self.pose.y, o.x - self.pose.x);
    const bearing = Math.abs(normalizeAngle(toO - self.pose.theta));
    const relevant = self.speed > 0.05 ? bearing < 0.7 : bearing < 1.4;
    if (!relevant) continue;
    if (!best || o.distance < best.distance) best = o;
  }
  return best;
}

function clearanceMetres(warehouse: Warehouse, p: { x: number; y: number }) {
  const grid = warehouse.grid;
  const c = grid.worldToCell(p.x, p.y);
  const ix = Math.max(0, Math.min(grid.spec.cols - 1, c.ix));
  const iy = Math.max(0, Math.min(grid.spec.rows - 1, c.iy));
  return grid.clearance[grid.idx(ix, iy)] * grid.spec.cell;
}

function normalizeAngle(a: number) {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function hashContext(o: Record<string, string | number>): number {
  let h = 2166136261 >>> 0;
  const s = JSON.stringify(o);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000000;
}
