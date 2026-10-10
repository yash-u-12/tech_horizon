/**
 * FLEET TELEMETRY PUBLISHER
 *
 * Smooths the 10 Hz engine snapshot into a 5-second Firebase digest under
 * `ragha/robots/<robotId>`. Runs once per page-load (idempotent — re-mounts in
 * React.StrictMode do not create duplicate timers) and is fully non-blocking:
 * a slow network never queues up back-to-back writes.
 *
 * Nothing here touches `ragha/robots/<id>/command` (actuation input stays
 * untouched) and the whole-tree `set` on the `ragha` root was removed because
 * it wiped unrelated fields such as `currentTask` and `command`. Telemetry is
 * per-robot merge-only; the only root-level write is a harmless `update` of the
 * fleet metadata node.
 */

import { runtime } from '@/simulation/runtime';
import type { Snapshot } from '@/simulation/engine';
import {
  isFirebaseConfigured,
  publishRaghaFleetMeta,
  publishRaghaRobot,
  publishRaghaRacks,
  type RaghaDataSource,
  type RaghaRobot,
} from './firebase';

/** How often the fleet digest is refreshed. */
export const FLEET_TELEMETRY_INTERVAL_MS = 5000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let publishing = false;
let lastRackSignature = '';

/** Start the 5-second fleet digest. Safe to call more than once. */
export function ensureFleetTelemetry(): void {
  if (started || !isFirebaseConfigured()) return;
  started = true;
  publishOnce();
  timer = setInterval(() => {
    if (!publishing) void publishOnce();
  }, FLEET_TELEMETRY_INTERVAL_MS);
}

/** Stop publishing (useful for tests / page teardown). */
export function stopFleetTelemetry(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

async function publishOnce(root = runtime.snapshot): Promise<void> {
  if (publishing) return;
  publishing = true;
  try {
    await publishRackCatalog(root);
    for (const robot of root.robots) {
      const payload = buildRobotDigest(robot.id, root);
      if (payload) await publishRaghaRobot(robot.id, payload);
    }
    await publishRaghaFleetMeta(root.robots.length);
  } finally {
    publishing = false;
  }
}

/** Racks only change when the layout changes — write them once. */
async function publishRackCatalog(root: Snapshot): Promise<void> {
  const racks = runtime.engine.warehouse.racks;
  const signature = racks.map((r) => `${r.id}:${r.x},${r.y},${r.w},${r.h}`).join('|');
  if (signature === lastRackSignature) return;
  lastRackSignature = signature;

  const catalog: Record<string, { x: number; y: number; w: number; h: number; pickFace: { x: number; y: number } | null }> = {};
  for (const rack of racks) {
    catalog[rack.id] = {
      x: rack.x,
      y: rack.y,
      w: rack.w,
      h: rack.h,
      pickFace: rack.pickFace ? { x: rack.pickFace.x, y: rack.pickFace.y } : null,
    };
  }
  await publishRaghaRacks(catalog);
}

function buildRobotDigest(robotId: string, root: Snapshot): RaghaRobot | null {
  const state = root.robots.find((r) => r.id === robotId);
  const context = root.contexts[robotId];
  if (!state) return null;

  const task = state.taskId ? root.tasks.find((t) => t.id === state.taskId) ?? null : null;
  const now = Date.now();

  const isPhysicalBound = state.executionMode === 'PHYSICAL';
  const dataSource: RaghaDataSource = isPhysicalBound
    ? state.twin.hardwareClass === 'PHYSICAL'
      ? 'PHYSICAL-ROS2'
      : 'PHYSICAL-MOCK'
    : 'SIMULATION';

  const robot: RaghaRobot = {
    virtualState: {
      x: state.pose.x,
      y: state.pose.y,
      theta: state.pose.theta,
      timestamp: now,
      source: dataSource,
    },
    health: {
      batteryPercentage: Math.round(state.battery),
      internalTempC: null,
      status: state.status,
      sensorStatus: state.capabilities.lidar ? { lidar: true, healthy: !state.estop } : null,
      faultCode: state.estop ? 'ESTOP' : null,
      updatedAt: now,
      source: dataSource,
    },
    currentTask: {
      taskId: state.taskId,
      destination: state.destination ?? null,
      taskStatus: task ? task.state : null,
      phase: task ? task.phase : null,
      pickup: task && task.type === 'PICK_DELIVER' ? { x: task.from.x, y: task.from.y } : null,
      updatedAt: now,
    },
    position: {
      x: state.pose.x,
      y: state.pose.y,
      theta: state.pose.theta,
      timestamp: now,
    },
    location: {
      zone: context?.location.zoneKind ?? null,
      timestamp: now,
    },
    connection: {
      online: state.connected,
      lastHeartbeat: now,
      lastSuccessfulUpdate: now,
      source: dataSource,
    },
  };

  if (isPhysicalBound) {
    const reported = state.twin.physicalPose ?? null;
    robot.physicalState = {
      x: reported?.x ?? state.pose.x,
      y: reported?.y ?? state.pose.y,
      theta: reported?.theta ?? state.pose.theta,
      speed: state.speed,
      battery: state.twin.batteryReported ?? null,
      positionError: state.twin.positionError,
      sync: state.twin.sync,
      timestamp: now,
      source: dataSource === 'PHYSICAL-ROS2' ? 'PHYSICAL-ROS2' : 'PHYSICAL-MOCK',
    };
  }

  return robot;
}

// Used by tests and headless tooling.
export { buildRobotDigest };