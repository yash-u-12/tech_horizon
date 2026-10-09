/**
 * EXECUTION BACKENDS
 *
 *   RobotAgent ──▶ decision ──▶ MotionCommand ──▶ RobotExecutionBackend
 *                                                     ├── SimulationBackend
 *                                                     └── PhysicalBackend
 *
 * The agent emits identical commands either way. SimulationBackend integrates
 * them into the shared world; PhysicalBackend pushes them through the safety
 * layer to a RobotInterface and then treats the returning telemetry as
 * AUTHORITATIVE for the robot's state — which is what makes the on-screen
 * robot a digital twin rather than an animation of a plan.
 */

import type { DigitalTwinState, Pose, RobotState, Telemetry } from '../types';
import type { MotionCommand } from '../navigation/controller';
import { integrateBody } from '../navigation/controller';
import { clamp, dist, ema } from '../core/math';
import type { RobotInterface } from './interfaces';
import { validateCommand, type SafetyContext } from './safety';
import { WORLD_H, WORLD_W } from '../environment/warehouse';

export interface BackendWorldView {
  obstacles: { x: number; y: number; r: number }[];
  peers: { id: string; x: number; y: number; vx: number; vy: number }[];
  restricted: { x0: number; y0: number; x1: number; y1: number }[];
  speedCap: number;
  /** static drivability test — a body must never occupy warehouse structure */
  isDrivable?: (x: number, y: number) => boolean;
}

export interface RobotExecutionBackend {
  readonly kind: 'SIMULATION' | 'PHYSICAL';
  readonly label: string;
  /** hardware id, only for physical */
  readonly hardwareId: string | null;
  apply(cmd: MotionCommand, state: RobotState, dt: number, world: BackendWorldView, now: number): void;
  /** returns the authoritative pose after execution */
  sync(state: RobotState, dt: number, now: number): void;
  reset(state: RobotState, pose: Pose): void;
  drainBattery(state: RobotState, dt: number): void;
}

// ─────────────────────────────────────────────────────────────────────────────

export class SimulationBackend implements RobotExecutionBackend {
  readonly kind = 'SIMULATION' as const;
  readonly label = 'SIMULATION ADAPTER';
  readonly hardwareId = null;

  apply(cmd: MotionCommand, state: RobotState, dt: number, world: BackendWorldView) {
    const res = integrateBody(
      state.pose,
      cmd.v,
      cmd.w,
      state.speed,
      dt,
      state.capabilities,
      { w: WORLD_W, h: WORLD_H },
      world.isDrivable,
    );
    if (res.blocked) state.binding.lastRejection = 'STATIC COLLISION AVOIDED';
    state.pose.x = res.x;
    state.pose.y = res.y;
    state.pose.theta = res.theta;
    state.speed = res.v;
    state.vx = res.vx;
    state.vy = res.vy;
    state.accel = res.accel;
    state.omega = cmd.w;
    state.distanceTravelled += Math.abs(res.v) * dt;
  }

  sync() {
    /* nothing to reconcile: the sim body is the source of truth */
  }

  reset(state: RobotState, pose: Pose) {
    state.pose = { ...pose };
    state.speed = 0;
    state.vx = 0;
    state.vy = 0;
    state.omega = 0;
  }

  drainBattery(state: RobotState, dt: number) {
    const moving = Math.abs(state.speed) > 0.05;
    const turning = Math.abs(state.omega) > 0.1;
    const load = state.payloadKg > 0 ? 1 + state.payloadKg / 12 : 1;
    const drain = (0.05 + (moving ? Math.abs(state.speed) * 0.38 : 0) + (turning ? 0.06 : 0)) * load * dt;
    state.battery = clamp(state.battery - drain, 0, 100);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface PhysicalBackendOptions {
  hardwareId: string;
  iface: RobotInterface;
  /** MOCK hardware must be labelled everywhere, never passed off as real */
  mock: boolean;
}

export class PhysicalBackend implements RobotExecutionBackend {
  readonly kind = 'PHYSICAL' as const;
  readonly label: string;
  readonly hardwareId: string;
  private iface: RobotInterface;
  private seq = 0;
  private lastSeq = 0;
  private mock: boolean;

  /** last telemetry arrival time, for age computation */
  private lastTelemetryAt = -Infinity;
  /** pose we dead-reckon between telemetry packets */
  private predicted: Pose | null = null;

  constructor(opts: PhysicalBackendOptions) {
    this.hardwareId = opts.hardwareId;
    this.iface = opts.iface;
    this.mock = opts.mock;
    this.label = opts.mock ? 'PHYSICAL ADAPTER · MOCK HARDWARE' : 'PHYSICAL ADAPTER';
  }

  apply(cmd: MotionCommand, state: RobotState, dt: number, world: BackendWorldView, now: number) {
    const ctx: SafetyContext = {
      pose: state.pose,
      currentSpeed: state.speed,
      capabilities: state.capabilities,
      obstacles: world.obstacles,
      peers: world.peers,
      restricted: world.restricted,
      bounds: { w: WORLD_W, h: WORLD_H },
      estop: state.estop,
      speedCap: world.speedCap,
      dt,
    };

    const verdict = validateCommand(
      {
        robotId: state.id,
        hardwareId: this.hardwareId,
        seq: ++this.seq,
        v: cmd.v,
        w: cmd.w,
        action: state.action,
        t: now,
        clamped: false,
      },
      ctx,
    );

    if (!verdict.allowed) {
      state.binding.rejectedCommands++;
      state.binding.lastRejection = verdict.reason;
    } else if (verdict.clamped && verdict.reason) {
      state.binding.lastRejection = verdict.reason;
    }

    this.iface.sendCommand({
      robotId: state.id,
      hardwareId: this.hardwareId,
      seq: this.seq,
      v: verdict.v,
      w: verdict.w,
      action: verdict.hardStop ? 'ESTOP' : state.action,
      t: now,
      clamped: verdict.clamped,
      clampReason: verdict.reason,
    });

    // Dead-reckon locally so the twin still moves smoothly if a packet is lost.
    if (!this.predicted) this.predicted = { ...state.pose };
    this.predicted.theta += verdict.w * dt;
    this.predicted.x += Math.cos(this.predicted.theta) * verdict.v * dt;
    this.predicted.y += Math.sin(this.predicted.theta) * verdict.v * dt;
  }

  /** Telemetry is authoritative. This is what makes it a digital twin. */
  sync(state: RobotState, dt: number, now: number) {
    const t = this.iface.readTelemetry();
    const twin = state.twin;
    twin.hardwareId = this.hardwareId;
    twin.hardwareClass = this.mock ? 'MOCK' : 'PHYSICAL';

    if (t && t.seq !== this.lastSeq) {
      this.lastSeq = t.seq;
      this.lastTelemetryAt = now;
      twin.packetsReceived++;
      twin.physicalPose = { ...t.pose };
      twin.batteryReported = t.battery;

      // error between what we predicted and what the robot actually did
      if (this.predicted) {
        twin.positionError = dist(this.predicted.x, this.predicted.y, t.pose.x, t.pose.y);
        twin.headingError = Math.abs(t.pose.theta - this.predicted.theta);
      }
      twin.errorHistory.push(twin.positionError);
      if (twin.errorHistory.length > 60) twin.errorHistory.shift();

      // ── authoritative state transfer ──────────────────────────────────────
      const prevX = state.pose.x;
      const prevY = state.pose.y;
      state.pose = { ...t.pose };
      state.vx = t.vx;
      state.vy = t.vy;
      state.speed = t.speed;
      state.omega = t.omega;
      state.battery = t.battery;
      state.estop = t.estop;
      state.distanceTravelled += dist(prevX, prevY, t.pose.x, t.pose.y);

      // resync the dead-reckoning anchor to reality
      this.predicted = { ...t.pose };

      const interval = 1 / Math.max(1, twin.updateHz);
      twin.updateHz = ema(twin.updateHz || 20, 1 / Math.max(1e-3, now - (twin.lastTelemetryAt || now - interval)), 0.2);
      twin.lastTelemetryAt = now;
      twin.telemetryAge = 0;

      if (t.estop) state.status = 'ESTOP';
      else if (state.binding.stage === 'ACTIVE') state.status = t.status;
    } else {
      twin.telemetryAge = now - this.lastTelemetryAt;
      // extrapolate so the twin is never frozen mid-motion
      if (this.predicted && Number.isFinite(this.lastTelemetryAt)) {
        const age = Math.min(twin.telemetryAge, 1.5);
        state.pose.x = this.predicted.x;
        state.pose.y = this.predicted.y;
        state.pose.theta = this.predicted.theta;
        void age;
      }
    }

    const age = twin.telemetryAge;
    twin.sync =
      this.iface.status === 'OFFLINE' ? 'OFFLINE' :
      !Number.isFinite(this.lastTelemetryAt) ? 'STALE' :
      age < 0.25 ? 'SYNCED' :
      age < 0.8 ? 'DRIFTING' :
      age < 2.2 ? 'STALE' : 'LOST';

    twin.latencyMs = (twin.latencyMs ?? 0) * 0.9 + 0.1 * (age * 1000);
    twin.packetsDropped = this.iface.droppedPackets;
    twin.heartbeatMs = twin.telemetryAge * 1000;
    if (twin.errorHistory.length === 0) twin.errorHistory.push(0);
  }

  reset(state: RobotState, pose: Pose) {
    state.pose = { ...pose };
    state.speed = 0;
    this.predicted = { ...pose };
    this.lastSeq = -1;
    this.lastTelemetryAt = -Infinity;
    state.twin.sync = 'STALE';
  }

  drainBattery() {
    /* physical battery is reported by telemetry, never inferred */
  }

  /** Adopt the hardware's real pose — used at the end of a bind. */
  adoptPhysicalPose(state: RobotState) {
    const t = this.iface.readTelemetry();
    const p = t ? t.pose : (this.iface as any).truePose ?? state.pose;
    state.pose = { ...p };
    state.speed = 0;
    state.vx = 0;
    state.vy = 0;
    this.predicted = { ...p };
    this.lastSeq = t?.seq ?? -1;
    this.lastTelemetryAt = -Infinity;
  }
}

export function makeTwin(robotId: string): DigitalTwinState {
  return {
    robotId,
    hardwareId: null,
    hardwareClass: 'NONE',
    sync: 'OFFLINE',
    positionError: 0,
    headingError: 0,
    latencyMs: 0,
    packetLoss: 0,
    lastTelemetryAt: 0,
    telemetryAge: 0,
    packetsReceived: 0,
    packetsDropped: 0,
    physicalPose: null,
    virtualPose: null,
    heartbeatMs: 0,
    updateHz: 20,
    errorHistory: [],
    batteryReported: 0,
  };
}

export type { Telemetry };
