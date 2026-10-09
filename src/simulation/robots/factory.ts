/**
 * Robot factory. Each agent gets its own deterministic personality traits so
 * that two agents facing identical situations genuinely behave differently —
 * one detours, one waits, one docks early. This is what makes "individual
 * context-aware intelligence" observable rather than asserted.
 */

import type { Pose, RobotCapabilities, RobotMemory, RobotState, RobotTraits } from '../types';
import { makeTwin } from './backend';
import { makeBindingState } from './binding';
import { hashString } from '../core/rng';

/** Restrained industrial tints — used for per-agent identification accents. */
export const ROBOT_COLOURS = [
  '#38BDF8', '#34D399', '#A78BFA', '#FB923C',
  '#FBBF24', '#22D3EE', '#F472B6', '#94A3B8',
  '#4ADE80', '#60A5FA', '#C084FC', '#FCD34D',
];

export function makeTraits(seed: number, id: string): RobotTraits {
  const h = (hashString(id) ^ seed) >>> 0;
  const r = (i: number) => ((h >>> (i * 5)) & 0xff) / 255;
  return {
    // 0.25 – 0.85
    assertiveness: 0.25 + r(0) * 0.6,
    // 0.18 – 0.34 → dock between 18% and 34%
    chargeThreshold: 0.18 + r(1) * 0.16,
    // 0.15 – 0.95
    congestionAversion: 0.15 + r(2) * 0.8,
    // 0.35 – 1.0
    eagerness: 0.35 + r(3) * 0.65,
  };
}

export function makeMemory(seed: number, id: string): RobotMemory {
  return {
    knownBlocked: new Map(),
    peerBelief: new Map(),
    lastPositions: [],
    frustration: 0,
    lastReplanAt: -99,
    yieldingTo: null,
    holdSince: null,
    stuckTicks: 0,
    traits: makeTraits(seed, id),
  };
}

export function makeRobotState(
  id: string,
  pose: Pose,
  capabilities: RobotCapabilities,
  colour: string,
  battery = 0,
): RobotState {
  const h = hashString(id);
  const b = battery || 62 + ((h >>> 3) % 36);
  return {
    id,
    name: `${id} AMR`,
    real: false,
    executionMode: 'SIMULATION',
    hardwareId: null,
    pose: { ...pose },
    vx: 0,
    vy: 0,
    speed: 0,
    omega: 0,
    accel: 0,
    battery: b,
    payloadKg: 0,
    carryingPackageId: null,
    status: 'IDLE',
    navState: 'NO_PLAN',
    taskId: null,
    taskPhase: null,
    destination: null,
    destinationLabel: null,
    taskPriority: null,
    plan: null,
    planHistory: [],
    trail: [],
    completedTasks: 0,
    replanCount: 0,
    distanceTravelled: 0,
    utilisation: 0,
    latencyMs: 8 + ((h >>> 7) % 12),
    packetLoss: 0,
    lastHeartbeat: 0,
    connected: true,
    safetyRadius: 0.62,
    estop: false,
    capabilities,
    twin: makeTwin(id),
    memory: makeMemory(0, id),
    lastDecision: null,
    decisionHistory: [],
    action: 'IDLE',
    binding: makeBindingState(),
    colour,
  };
}
