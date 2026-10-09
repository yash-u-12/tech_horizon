/**
 * DECENTRALISED TASK ALLOCATION — market-based auction.
 *
 * There is no allocator service. The WMS (a dumb order source) broadcasts an
 * ANNOUNCE. Every agent independently decides, from its OWN context, whether it
 * is eligible and what the job is worth to it, then broadcasts a bid. Every
 * agent then independently runs the SAME deterministic winner function over the
 * bids it actually received and, if it believes it won, claims the job.
 *
 * Because the channel is lossy, two agents can occasionally both believe they
 * won. That is resolved by claim arbitration (`resolveClaims`) — again, locally
 * and deterministically, with no referee.
 */

import type { RobotContext, RobotState, TaskBid } from '../types';
import type { Message } from '../communication/bus';

export interface AnnouncePayload {
  taskId: string;
  priority: RobotContext['task']['priority'];
  from: { x: number; y: number };
  to: { x: number; y: number };
  requiresLidar: boolean;
  weightKg: number;
}

export interface BidWeights {
  distance: number;
  battery: number;
  workload: number;
  congestion: number;
  eta: number;
  /** per-agent personality modulation */
  eagerness: number;
  congestionAversion: number;
}

/**
 * Each agent scores the job for ITSELF. Note the inputs: its own distance to
 * the pickup, its own battery, its own workload, its own congestion estimate.
 * Nothing global except the announcement.
 */
export function computeBid(
  self: RobotState,
  ctx: RobotContext,
  ann: AnnouncePayload,
  distanceToPickup: number,
  distancePickupToDrop: number,
  cruiseSpeed: number,
): { bid: TaskBid | null; reason?: string } {
  if (self.status === 'OFFLINE' || self.status === 'ESTOP') return { bid: null, reason: 'OFFLINE' };
  if (self.binding.stage !== 'IDLE' && self.binding.stage !== 'ACTIVE') return { bid: null, reason: 'BINDING' };
  if (self.taskId) return { bid: null, reason: 'ALREADY COMMITTED' };
  if (ann.requiresLidar && !self.capabilities.lidar) return { bid: null, reason: 'NO LIDAR' };
  if (ann.weightKg > self.capabilities.payloadKg) return { bid: null, reason: 'PAYLOAD LIMIT' };

  const traits = self.memory.traits;
  // an agent derates its own bid if it is not sure it can finish the job
  const energyNeeded = (distanceToPickup + distancePickupToDrop) / 90 * 100; // ~ % battery
  if (self.battery < 12) return { bid: null, reason: 'BATTERY CRITICAL' };
  if (self.battery < energyNeeded + 12) return { bid: null, reason: 'INSUFFICIENT RESERVE' };

  const eta = (distanceToPickup + distancePickupToDrop) / cruiseSpeed + 6;
  const workload = self.completedTasks * 0.4 + (self.taskId ? 2 : 0);
  const congestion = ctx.traffic.localDensity * 10 + ctx.traffic.nearbyCount * 0.6;

  const w: BidWeights = {
    distance: 1.0,
    battery: 14,
    workload: 1.6,
    congestion: 0.55 + traits.congestionAversion * 0.9,
    eta: 0.35,
    eagerness: traits.eagerness,
    congestionAversion: traits.congestionAversion,
  };

  const batteryPenalty = Math.max(0, (70 - self.battery) / 70) * w.battery;
  const tDistance = distanceToPickup * w.distance;
  const tWorkload = workload * w.workload;
  const tCongestion = congestion * w.congestion;
  const tEta = eta * w.eta;
  const rawCost = tDistance + batteryPenalty + tWorkload + tCongestion + tEta;

  // eagerness: a keen agent undercuts its own estimate
  const traitScale = 1.18 - 0.32 * w.eagerness;
  // urgency: critical jobs are worth taking even when far away
  const urgencyScale =
    ann.priority === 'CRITICAL' ? 0.78 : ann.priority === 'HIGH' ? 0.9 : ann.priority === 'LOW' ? 1.15 : 1;
  const cost = rawCost * traitScale * urgencyScale;

  const reasoning =
    `${distanceToPickup.toFixed(1)}m away · battery ${self.battery.toFixed(0)}% · ` +
    `local density ${(ctx.traffic.localDensity * 100).toFixed(0)}% · ` +
    `congestion weight ${w.congestion.toFixed(2)} (aversion ${traits.congestionAversion.toFixed(2)}) · ` +
    `eagerness scale ${traitScale.toFixed(2)} · ${ann.priority} urgency ${urgencyScale.toFixed(2)}`;

  return {
    bid: {
      robotId: self.id,
      cost: Math.round(cost * 100) / 100,
      distance: Math.round(distanceToPickup * 10) / 10,
      battery: Math.round(self.battery),
      workload: Math.round(workload * 10) / 10,
      congestion: Math.round(congestion * 10) / 10,
      eta: Math.round(eta * 10) / 10,
      accepted: true,
      at: ctx.at,
      breakdown: {
        distance: Math.round(tDistance * 100) / 100,
        battery: Math.round(batteryPenalty * 100) / 100,
        workload: Math.round(tWorkload * 100) / 100,
        congestion: Math.round(tCongestion * 100) / 100,
        eta: Math.round(tEta * 100) / 100,
        traitScale: Math.round(traitScale * 100) / 100,
        eagerness: Math.round(traits.eagerness * 100) / 100,
        congestionAversion: Math.round(traits.congestionAversion * 100) / 100,
      },
      reasoning,
    },
  };
}

/**
 * Deterministic winner selection. Every agent runs this on the bids it holds.
 * Because the comparator is total and symmetric, agents that heard the same set
 * reach the same conclusion — agreement emerges without a coordinator.
 */
export function selectWinner(bids: TaskBid[]): TaskBid | null {
  if (!bids.length) return null;
  let best = bids[0];
  for (let i = 1; i < bids.length; i++) {
    const b = bids[i];
    if (b.cost < best.cost - 1e-6) best = b;
    else if (Math.abs(b.cost - best.cost) <= 1e-6 && b.robotId < best.robotId) best = b;
  }
  return best;
}

/**
 * Claim arbitration. If two agents claimed (they lost each other's bids), the
 * lower-cost claim stands; the other releases. Deterministic, no referee.
 */
export function resolveClaims(claims: { robotId: string; cost: number; at: number }[]): string | null {
  if (!claims.length) return null;
  let best = claims[0];
  for (let i = 1; i < claims.length; i++) {
    const c = claims[i];
    if (c.cost < best.cost - 1e-6) best = c;
    else if (Math.abs(c.cost - best.cost) <= 1e-6 && (c.at < best.at || (c.at === best.at && c.robotId < best.robotId))) best = c;
  }
  return best.robotId;
}

export function isAnnounce(m: Message): m is Extract<Message, { kind: 'TASK_ANNOUNCE' }> {
  return m.kind === 'TASK_ANNOUNCE';
}
