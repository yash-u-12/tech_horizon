/**
 * ROBOT INTERFACES
 *
 * Three interchangeable implementations of the same boundary:
 *
 *   SimulatedRobotInterface   — a perfect, instantaneous body inside the sim
 *   MockPhysicalRobotInterface— a *separate* physical simulation with latency,
 *                               packet loss, wheel slip and drift. It owns its
 *                               own state, so the digital twin has something
 *                               real to shadow. Clearly labelled MOCK.
 *   PhysicalRobotInterface    — the ROS 2 / WebSocket transport boundary. The
 *                               agent code is byte-for-byte identical.
 *
 * The agent never knows which one it is talking to. That is the whole point of
 * §47A: THE AGENT IS NOT THE BODY.
 */

import type { Pose, RobotCapabilities, RobotCommand, RobotOperationalStatus, Telemetry } from '../types';
import { clamp, wrapAngle } from '../core/math';
import type { Rng } from '../core/rng';

export type HardwareStatus = 'ONLINE' | 'BUSY' | 'OFFLINE' | 'FAULT' | 'ESTOP';

export interface RobotInterface {
  readonly id: string;
  readonly mock: boolean;
  readonly status: HardwareStatus;
  connect(): void;
  disconnect(): void;
  sendCommand(cmd: RobotCommand): void;
  /** Most recent telemetry, or null when nothing has arrived yet. */
  readTelemetry(): Telemetry | null;
  estop(): void;
  clearEstop(): void;
  /** advance the hardware's own clock/transport */
  tick(now: number, dt: number): void;
  setLinkQuality(latency: number, loss: number): void;
  readonly telemetrySeq: number;
  readonly droppedPackets: number;
  readonly receivedCommands: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulated body
// ─────────────────────────────────────────────────────────────────────────────

export class SimulatedRobotInterface implements RobotInterface {
  readonly id: string;
  readonly mock = true;
  status: HardwareStatus = 'ONLINE';
  private last: Telemetry | null = null;
  private seq = 0;
  private dropped = 0;
  private received = 0;
  battery = 100;

  constructor(id: string) {
    this.id = id;
  }
  connect() {
    this.status = 'ONLINE';
  }
  disconnect() {
    this.status = 'OFFLINE';
  }
  sendCommand(cmd: RobotCommand) {
    this.received++;
    this.last = {
      robotId: cmd.robotId,
      hardwareId: this.id,
      t: cmd.t,
      pose: { x: 0, y: 0, theta: 0 },
      vx: 0,
      vy: 0,
      speed: cmd.v,
      omega: cmd.w,
      battery: this.battery,
      scan: [],
      scanFov: Math.PI * 2,
      status: 'MOVING',
      estop: false,
      seq: ++this.seq,
      mock: true,
    };
  }
  readTelemetry() {
    return this.last;
  }
  estop() {
    this.status = 'ESTOP';
  }
  clearEstop() {
    this.status = 'ONLINE';
  }
  tick() {}
  setLinkQuality() {}
  get telemetrySeq() {
    return this.seq;
  }
  get droppedPackets() {
    return this.dropped;
  }
  get receivedCommands() {
    return this.received;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock PHYSICAL body — an independent physical simulation behind a transport
// ─────────────────────────────────────────────────────────────────────────────

export interface MockHardwareOptions {
  id: string;
  model: string;
  start: Pose;
  capabilities: RobotCapabilities;
  battery: number;
  rng: Rng;
  /** one-way transport latency, seconds */
  latency?: number;
  /** uplink + downlink packet loss probability */
  loss?: number;
  /** telemetry publish rate, Hz */
  telemetryHz?: number;
  /** positional drift per metre travelled (wheel slip model) */
  slip?: number;
}

/**
 * This class is the stand-in for a real AMR + ROS2 gateway. Critically it keeps
 * its OWN pose. Commands arrive late, are executed imperfectly, and telemetry
 * comes back late and sometimes not at all — so the digital twin must genuinely
 * track, extrapolate and flag drift rather than just echoing the plan.
 */
export class MockPhysicalRobotInterface implements RobotInterface {
  readonly id: string;
  readonly mock = true;
  readonly model: string;
  status: HardwareStatus = 'ONLINE';

  private pose: Pose;
  private v = 0;
  private w = 0;
  private battery: number;
  private caps: RobotCapabilities;
  private rng: Rng;
  private latency: number;
  private loss: number;
  private hz: number;
  private slip: number;

  private inFlight: { cmd: RobotCommand; arriveAt: number }[] = [];
  private active: RobotCommand | null = null;
  private estopped = false;

  private nextTelemetryAt = 0;
  private lastTelemetry: Telemetry | null = null;
  private seq = 0;
  private dropped = 0;
  private received = 0;
  private now = 0;
  private statusOut: RobotOperationalStatus = 'IDLE';

  /** ground-truth travelled distance, used for odometry-style drift */
  private odometry = 0;

  constructor(opts: MockHardwareOptions) {
    this.id = opts.id;
    this.model = opts.model;
    this.pose = { ...opts.start };
    this.battery = opts.battery;
    this.caps = opts.capabilities;
    this.rng = opts.rng;
    this.latency = opts.latency ?? 0.08;
    this.loss = opts.loss ?? 0.01;
    this.hz = opts.telemetryHz ?? 20;
    this.slip = opts.slip ?? 0.012;
  }

  connect() {
    this.status = 'ONLINE';
  }
  disconnect() {
    this.status = 'OFFLINE';
    this.inFlight.length = 0;
    this.active = null;
  }

  getTelemetrySeq() {
    return this.seq;
  }
  get telemetrySeq() {
    return this.seq;
  }
  get droppedPackets() {
    return this.dropped;
  }
  get receivedCommands() {
    return this.received;
  }

  sendCommand(cmd: RobotCommand) {
    if (this.status === 'OFFLINE') return;
    this.received++;
    // transport: uplink may drop the packet entirely
    if (this.rng() < this.loss) {
      this.dropped++;
      return;
    }
    this.inFlight.push({ cmd, arriveAt: this.now + this.latency * (0.7 + this.rng() * 0.7) });
  }

  /** Called by the simulation engine every tick — this is the robot's own time. */
  tick(now: number, dt: number) {
    this.now = now;
    if (this.status === 'OFFLINE' || this.status === 'FAULT') return;

    // ── command pipeline (latency + hold-last-command semantics) ─────────────
    while (this.inFlight.length && this.inFlight[0].arriveAt <= now) {
      this.active = this.inFlight.shift()!.cmd;
    }
    const cmd = this.active;
    const targetV = this.estopped ? 0 : cmd?.v ?? 0;
    const targetW = this.estopped ? 0 : cmd?.w ?? 0;

    // ── physical dynamics with imperfection ──────────────────────────────────
    const accelLimit = this.caps.maxAccel * (0.9 + this.rng() * 0.2);
    this.v += clamp(targetV - this.v, -accelLimit * dt, accelLimit * dt);
    this.w += clamp(targetW - this.w, -this.caps.maxOmega * dt * 6, this.caps.maxOmega * dt * 6);
    this.v = clamp(this.v, 0, this.caps.maxVelocity);
    this.w = clamp(this.w, -this.caps.maxOmega, this.caps.maxOmega);

    // wheel slip: an unmodelled lateral/angular perturbation
    const slipTheta = (this.rng() - 0.5) * this.slip * Math.abs(this.v) * 6;
    const slipV = 1 + (this.rng() - 0.5) * this.slip * 2;

    this.pose.theta = wrapAngle(this.pose.theta + (this.w + slipTheta) * dt);
    this.pose.x = clamp(this.pose.x + Math.cos(this.pose.theta) * this.v * slipV * dt, 0.4, 43.6);
    this.pose.y = clamp(this.pose.y + Math.sin(this.pose.theta) * this.v * slipV * dt, 0.4, 31.6);
    this.odometry += Math.abs(this.v) * dt;

    // battery: base drain + motion drain
    const drain = (0.06 + Math.abs(this.v) * 0.42 + Math.abs(this.w) * 0.05) * dt;
    this.battery = clamp(this.battery - drain, 0, 100);
    if (this.battery <= 0.5) this.status = 'FAULT';

    this.statusOut =
      this.estopped ? 'ESTOP' :
      this.battery < 12 ? 'DEGRADED' :
      Math.abs(this.v) > 0.05 ? 'MOVING' :
      this.w !== 0 ? 'MOVING' : 'IDLE';

    // ── telemetry publish (downlink, lossy) ─────────────────────────────────
    if (now >= this.nextTelemetryAt) {
      this.nextTelemetryAt = now + 1 / this.hz;
      const interval = 1 / this.hz;
      if (this.rng() < this.loss) {
        this.dropped++;
      } else {
        this.seq++;
        this.lastTelemetry = {
          robotId: '',
          hardwareId: this.id,
          t: now,
          pose: { x: this.pose.x, y: this.pose.y, theta: this.pose.theta },
          vx: Math.cos(this.pose.theta) * this.v,
          vy: Math.sin(this.pose.theta) * this.v,
          speed: this.v,
          omega: this.w,
          battery: this.battery,
          scan: buildScan(this.pose, this.caps.sensorRange),
          scanFov: Math.PI * 2,
          status: this.statusOut,
          estop: this.estopped,
          seq: this.seq,
          mock: true,
        };
        void interval;
      }
    }
  }

  readTelemetry() {
    return this.lastTelemetry;
  }
  estop() {
    this.estopped = true;
    this.status = 'ESTOP';
    this.active = null;
    this.inFlight.length = 0;
  }
  clearEstop() {
    this.estopped = false;
    this.status = 'ONLINE';
  }
  setLinkQuality(latency: number, loss: number) {
    this.latency = latency;
    this.loss = clamp(loss, 0, 0.95);
  }
  get truePose() {
    return { ...this.pose };
  }
  get energy() {
    return this.battery;
  }
  get odometryDistance() {
    return this.odometry;
  }
  get isEstopped() {
    return this.estopped;
  }
  setPose(p: Pose) {
    this.pose = { ...p };
    this.v = 0;
    this.w = 0;
  }
  setBattery(b: number) {
    this.battery = b;
  }
}

function buildScan(pose: Pose, range: number) {
  const N = 24;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    out[i] = range * (0.6 + 0.4 * Math.abs(Math.sin(a * 3 + pose.theta)));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real physical body (ROS 2 / WebSocket gateway)
// ─────────────────────────────────────────────────────────────────────────────

export interface PhysicalTransportConfig {
  endpoint: string;
  /** ROS 2 topic namespace, e.g. /nexus/p01 */
  namespace: string;
  telemetryTopic: string;
  commandTopic: string;
}

/**
 * The production boundary. Everything above the transport is already exercised
 * by the mock. When a real AMR is present, construct this instead — no agent,
 * planner or coordination code changes.
 *
 * Wire format is intentionally the same shape as `Telemetry` / `RobotCommand`
 * so a FastAPI/rosbridge gateway can forward JSON 1:1.
 */
export class PhysicalRobotInterface implements RobotInterface {
  readonly id: string;
  readonly mock = false;
  status: HardwareStatus = 'OFFLINE';
  private ws: WebSocket | null = null;
  private last: Telemetry | null = null;
  private seq = 0;
  private dropped = 0;
  private received = 0;
  private cfg: PhysicalTransportConfig;
  private latency = 0.08;
  private loss = 0;

  constructor(id: string, cfg: PhysicalTransportConfig) {
    this.id = id;
    this.cfg = cfg;
  }

  connect() {
    if (typeof WebSocket === 'undefined') {
      this.status = 'OFFLINE';
      return;
    }
    try {
      this.ws = new WebSocket(this.cfg.endpoint);
      this.ws.onopen = () => (this.status = 'ONLINE');
      this.ws.onclose = () => (this.status = 'OFFLINE');
      this.ws.onerror = () => (this.status = 'FAULT');
      this.ws.onmessage = (ev) => {
        try {
          const t = JSON.parse(ev.data as string) as Telemetry;
          this.last = t;
          this.seq = t.seq;
        } catch {
          this.dropped++;
        }
      };
    } catch {
      this.status = 'FAULT';
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.status = 'OFFLINE';
  }

  sendCommand(cmd: RobotCommand) {
    this.received++;
    if (!this.ws || this.ws.readyState !== 1) {
      this.dropped++;
      return;
    }
    this.ws.send(JSON.stringify({ op: 'publish', topic: this.cfg.commandTopic, msg: cmd }));
  }

  readTelemetry() {
    return this.last;
  }
  estop() {
    this.sendCommand({ robotId: '', hardwareId: this.id, seq: ++this.seq, v: 0, w: 0, action: 'ESTOP', t: 0, clamped: false });
  }
  clearEstop() {
    this.sendCommand({ robotId: '', hardwareId: this.id, seq: ++this.seq, v: 0, w: 0, action: 'STOP', t: 0, clamped: false });
  }
  tick() {}
  setLinkQuality(latency: number, loss: number) {
    this.latency = latency;
    this.loss = loss;
  }
  get telemetrySeq() {
    return this.seq;
  }
  get droppedPackets() {
    return this.dropped;
  }
  get receivedCommands() {
    return this.received;
  }
}
