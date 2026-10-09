/**
 * PERCEPTION — the sensor model.
 *
 * Every agent runs this independently. It converts GLOBAL truth into a
 * PARTIAL, NOISY, AGENT-LOCAL observation:
 *
 *   world truth ──▶ sensor geometry ──▶ LOS / range / noise ──▶ RobotPerception
 *                                    └─▶ comms (latency + loss) ─┘
 *
 * Nothing downstream of this file is allowed to read global truth, which is
 * what guarantees two robots standing in the same place can disagree.
 */

import type {
  DetectedObstacle,
  DetectedRobot,
  LocalOccupancy,
  PeerIntent,
  RobotPerception,
  RobotState,
  WarehouseObject,
  Vec2,
} from '../types';
import type { OccupancyGrid } from '../environment/grid';
import type { Warehouse } from '../environment/warehouse';
import { angleDelta, dist } from '../core/math';
import type { Rng } from '../core/rng';

export interface WorldTruth {
  time: number;
  grid: OccupancyGrid;
  warehouse: Warehouse;
  robots: RobotState[];
  /** intents published on the comms bus this tick */
  intents: Map<string, PeerIntent>;
  /** global packet-loss multiplier from the active scenario (0..1) */
  commsLoss: number;
  /** global latency in sim seconds */
  commsLatency: number;
}

const OCC_WINDOW = 9; // cells per side

export function perceive(
  self: RobotState,
  world: WorldTruth,
  rng: Rng,
  opts: { sensorScale?: number; degraded?: boolean } = {},
): RobotPerception {
  const sensorScale = opts.sensorScale ?? 1;
  const degraded = opts.degraded ?? false;
  const radius = self.capabilities.sensorRange * sensorScale * (degraded ? 0.6 : 1);
  const losRange = radius * (self.capabilities.lidar ? 1 : 0.55);

  // ── other robots ──────────────────────────────────────────────────────────
  const detectedRobots: DetectedRobot[] = [];
  for (const other of world.robots) {
    if (other.id === self.id) continue;
    if (other.status === 'OFFLINE') {
      // A dead robot is still physically there, but only if you can see it.
      // This is why virtual agents must track liveness themselves.
    }
    const d = dist(self.pose.x, self.pose.y, other.pose.x, other.pose.y);
    const inSensorRange = d <= radius;
    const hasLos = inSensorRange && lineOfSight(world.grid, self.pose, other.pose, Math.ceil(d / 0.35) + 4);

    // comms channel: subject to loss + latency
    const commsOk = rng() > world.commsLoss && other.connected;
    const viaComms = !inSensorRange && commsOk;

    if (!inSensorRange && !viaComms) continue;

    const age = viaComms ? world.commsLatency : 0;
    // comms gives you a stale pose; sensors give you the real one
    const px = viaComms ? other.pose.x - other.vx * age : other.pose.x;
    const py = viaComms ? other.pose.y - other.vy * age : other.pose.y;

    const critical = d < self.safetyRadius * 2.2;
    detectedRobots.push({
      id: other.id,
      x: px,
      y: py,
      heading: other.pose.theta,
      vx: viaComms ? other.vx * 0.8 : other.vx,
      vy: viaComms ? other.vy * 0.8 : other.vy,
      distance: dist(self.pose.x, self.pose.y, px, py),
      critical,
      yieldTo: false, // resolved later by the coordination layer, peer-to-peer
      viaComms,
      age,
      real: other.real || other.executionMode === 'PHYSICAL',
    });
  }
  detectedRobots.sort((a, b) => a.distance - b.distance);

  // ── obstacles ─────────────────────────────────────────────────────────────
  const detectedObstacles: DetectedObstacle[] = [];
  for (const o of world.warehouse.obstacles) {
    const d = dist(self.pose.x, self.pose.y, o.x, o.y);
    // obstacles beyond LOS range are only known if someone told you over comms
    const known = d <= losRange ? lineOfSight(world.grid, self.pose, { x: o.x, y: o.y }, 12) : rng() > 0.35 - 0.3 * (1 - world.commsLoss);
    if (d > radius * 1.6 || !known) continue;
    detectedObstacles.push({
      id: o.id,
      x: o.x,
      y: o.y,
      r: o.r,
      distance: d,
      blocksPath: false, // filled in below against the agent's own plan
    });
  }

  // ── static structures in view ─────────────────────────────────────────────
  const detectedStructures: WarehouseObject[] = [];
  for (const s of world.warehouse.objects) {
    if (s.kind === 'WALL') continue;
    if (dist(self.pose.x, self.pose.y, s.x, s.y) <= radius + Math.max(s.w, s.h)) detectedStructures.push(s);
  }

  // ── local occupancy window (the agent's own costmap patch) ────────────────
  const localOccupancy = buildLocalOccupancy(world.grid, self.pose, OCC_WINDOW, radius, losRange, rng);

  // ── peer intents received over comms ──────────────────────────────────────
  const peerIntents: PeerIntent[] = [];
  for (const [id, intent] of world.intents) {
    if (id === self.id) continue;
    if (rng() < world.commsLoss) continue; // dropped packet
    const age = world.time - intent.receivedAt + world.commsLatency;
    peerIntents.push({ ...intent, age, stale: age > 1.6 });
  }

  const perception: RobotPerception = {
    robotId: self.id,
    at: world.time,
    radius,
    detectedRobots,
    detectedObstacles,
    detectedStructures,
    blockedPlanCells: [],
    localOccupancy,
    localDensity: 0,
    peerIntents,
    degraded,
  };

  return perception;
}

/**
 * Check the agent's own plan against its own beliefs. Marks which plan indices
 * are now impassable. Purely a function of THIS agent's perception + memory.
 */
export function evaluatePlanAgainstBeliefs(
  self: RobotState,
  perception: RobotPerception,
  grid: OccupancyGrid,
  lookaheadMetres: number,
): { blocked: boolean; blockedIndices: number[]; obstacleAhead: DetectedObstacle | null } {
  const plan = self.plan;
  if (!plan || plan.points.length === 0) return { blocked: false, blockedIndices: [], obstacleAhead: null };

  const blockedIdx: number[] = [];
  let travelled = 0;
  let px = self.pose.x;
  let py = self.pose.y;
  let obstacleAhead: DetectedObstacle | null = null;

  for (let i = Math.max(1, plan.cursor); i < plan.points.length; i++) {
    const p = plan.points[i];
    const seg = dist(px, py, p.x, p.y);
    travelled += seg;
    px = p.x;
    py = p.y;
    if (travelled > lookaheadMetres) break;

    const c = grid.worldToCell(p.x, p.y);
    const staticallyBlocked = grid.dynamicMask[grid.idx(c.ix, c.iy)] === 1;

    let obsBlocked = false;
    for (const o of perception.detectedObstacles) {
      // inflate by the robot's own footprint — a 0.4 m crate blocks a 0.7 m AMR
      if (dist(p.x, p.y, o.x, o.y) < o.r + self.capabilities.footprint * 0.6) {
        obsBlocked = true;
        if (!obstacleAhead || o.distance < obstacleAhead.distance) {
          obstacleAhead = { ...o, blocksPath: true };
        }
        break;
      }
    }

    const remembered = self.memory.knownBlocked.has(`${c.ix},${c.iy}`);

    if (staticallyBlocked || obsBlocked || remembered) blockedIdx.push(i);
  }

  for (const o of perception.detectedObstacles) o.blocksPath = blockedIdx.length > 0 && !!obstacleAhead;

  return { blocked: blockedIdx.length > 0, blockedIndices: blockedIdx, obstacleAhead };
}

function buildLocalOccupancy(
  grid: OccupancyGrid,
  pose: { x: number; y: number },
  half: number,
  radius: number,
  losRange: number,
  rng: Rng,
): LocalOccupancy {
  const c = grid.worldToCell(pose.x, pose.y);
  const w = half * 2 + 1;
  const data = new Uint8Array(w * w);
  const cell = grid.spec.cell;
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      const ix = c.ix - half + i;
      const iy = c.iy - half + j;
      let v = 0;
      if (grid.inBounds(ix, iy)) {
        const idx = grid.idx(ix, iy);
        const blocked = grid.staticMask[idx] === 1 || grid.dynamicMask[idx] === 1;
        const p = grid.cellToWorld(ix, iy);
        const d = dist(pose.x, pose.y, p.x, p.y);
        const visible = d <= losRange && lineOfSight(grid, pose, p, Math.ceil(d / 0.4) + 3);
        if (blocked && (visible || d <= 1.5)) v = 1;
        else if (blocked && rng() < 0.5) v = 1; // partial prior beyond LOS
      } else {
        v = 1;
      }
      data[j * w + i] = v;
    }
  }
  return {
    w,
    h: w,
    origin: { x: pose.x - half * cell, y: pose.y - half * cell },
    cell,
    data,
  };
}

export function lineOfSight(grid: OccupancyGrid, a: Vec2, b: Vec2, samples = 20): boolean {
  const d = dist(a.x, a.y, b.x, b.y);
  const n = Math.max(4, Math.min(samples, Math.ceil(d / 0.3)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const c = grid.worldToCell(x, y);
    if (grid.isBlocked(c.ix, c.iy)) return false;
  }
  return true;
}

/** Is a peer roughly ahead of me and closing? Used for yield decisions. */
export function isApproaching(self: RobotState, other: DetectedRobot): boolean {
  const toOther = Math.atan2(other.y - self.pose.y, other.x - self.pose.x);
  const bearing = Math.abs(angleDelta(self.pose.theta, toOther));
  if (bearing > Math.PI / 3) return false;
  const closing = (other.x - self.pose.x) * self.vx + (other.y - self.pose.y) * self.vy;
  return closing > 0.05;
}
