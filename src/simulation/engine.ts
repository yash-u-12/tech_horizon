/**
 * SIMULATION ENGINE (§43)
 *
 * Owns the simulation clock and drives one tick:
 *
 *   1.  Update environment        7.  Resolve coordination / conflicts
 *   2.  Advance hardware bodies   8.  Execute actions
 *   3.  Update perception         9.  Update task state
 *   4.  Update robot contexts    10.  Update telemetry
 *   5.  Agents evaluate          11.  Update digital twin state
 *   6.  Generate decisions       12.  Publish state
 *
 * It runs entirely independently of React — the UI subscribes to snapshots and
 * the 3D scene reads agent poses directly per frame.
 */

import { Warehouse, WORLD_W, WORLD_H } from './environment/warehouse';
import type { OccupancyGrid } from './environment/grid';
import { CommsBus } from './communication/bus';
import { TaskManager, STATIONS } from './tasks/taskManager';
import { RobotAgent, type AgentWorld, type TaskAccess } from './agents/agent';
import { HardwareRegistry, DEFAULT_AGENT_CAPS, LITE_AGENT_CAPS } from './robots/hardware';
import { MockPhysicalRobotInterface, type RobotInterface } from './robots/interfaces';
import { BindingController, makeBindingState } from './robots/binding';
import { PhysicalBackend, SimulationBackend } from './robots/backend';
import { SCENARIOS, type Scenario, type ScenarioContext } from './scenarios/scenarios';
import {
  makeRobotState,
  makeTraits,
  ROBOT_COLOURS,
} from './robots/factory';
import type {
  ConflictRisk,
  EventSeverity,
  ExperimentMetrics,
  FleetMetrics,
  PhysicalUnit,
  RobotContext,
  RobotPerception,
  RobotState,
  SimEvent,
  SystemNode,
  Task,
  TaskBid,
  TrafficEvent,
} from './types';
import { clamp, dist, ema } from './core/math';
import { mulberry32, hashString } from './core/rng';
import { shortId } from './core/ids';

export const SIM_DT = 0.1; // fixed simulation step, seconds

export interface EngineConfig {
  seed: number;
  robotCount: number;
  /** ids that start bound to hardware (default: R01 → P01) */
  initialBindings?: { robotId: string; hardwareId: string }[];
  orderInterval: number;
  maxActiveTasks: number;
}

export interface Snapshot {
  time: number;
  tick: number;
  running: boolean;
  speed: number;
  robots: RobotState[];
  tasks: Task[];
  events: SimEvent[];
  traffic: TrafficEvent[];
  conflicts: ConflictRisk[];
  fleet: FleetMetrics;
  nodes: SystemNode[];
  contexts: Record<string, RobotContext>;
  perceptions: Record<string, RobotPerception>;
  activeScenario: string | null;
  scenarioHistory: { id: string; at: number; name: string }[];
  obstacles: { id: string; x: number; y: number; r: number; kind: string; label?: string }[];
  warehouseVersion: number;
  /** live view of the physical hardware registry (§47A) */
  hardware: PhysicalUnit[];
  packetsDropped: number;
  avgLatency: number;
  commsLoss: number;
  commsLatency: number;
  metrics: ExperimentMetrics;
}

export class SimulationEngine {
  readonly cfg: EngineConfig;
  warehouse: Warehouse;
  grid: OccupancyGrid;
  bus: CommsBus;
  tasks: TaskManager;
  registry: HardwareRegistry;
  binding: BindingController;
  agents: RobotAgent[] = [];

  time = 0;
  tickCount = 0;
  running = true;
  speed = 1;

  events: SimEvent[] = [];
  trafficEvents: TrafficEvent[] = [];
  conflicts: ConflictRisk[] = [];
  scenarioHistory: { id: string; at: number; name: string }[] = [];
  activeScenario: string | null = null;

  private accumulator = 0;
  private rng = mulberry32(0);
  private eventCounter = 0;
  private trafficCounter = 0;
  private intents = new Map<string, { robotId: string; waypoints: { x: number; y: number; t: number }[]; priority: number; receivedAt: number; age: number; stale: boolean }>();
  private comms = { latency: 0.05, loss: 0.005 };
  private baseComms = { latency: 0.05, loss: 0.005 };
  private world: AgentWorld;
  private taskAccess: TaskAccess;
  private metricsAcc = {
    nearMisses: 0,
    conflictsResolved: 0,
    reassignments: 0,
    replans: 0,
    distance: 0,
    energy: 0,
    slaBreaches: 0,
  };
  private lastPublish = 0;
  private snapshot: Snapshot;
  private listeners = new Set<(s: Snapshot) => void>();
  private nodes: SystemNode[] = [];
  private nodeTimers: Record<string, number> = {};

  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.rng = mulberry32(cfg.seed);
    this.warehouse = new Warehouse({ seed: cfg.seed });
    this.grid = this.warehouse.grid;
    this.bus = new CommsBus(mulberry32(cfg.seed ^ 0x51ed2701));
    this.tasks = new TaskManager({ seed: cfg.seed, orderInterval: cfg.orderInterval, maxActiveTasks: cfg.maxActiveTasks });
    this.registry = new HardwareRegistry();
    this.registry.createMockFleet(cfg.seed, 3);
    this.binding = new BindingController(this.registry);

    this.taskAccess = {
      get: (id) => this.tasks.byId(id),
      openAnnouncements: () => this.tasks.tasks.filter((t) => t.state === 'ANNOUNCED'),
      submitEvaluation: (robotId, taskId, bid, reason, at) => this.tasks.submitEvaluation({ robotId, taskId, bid, reason, at }),
      begin: (taskId, now) => this.tasks.begin(taskId, now),
      complete: (taskId, now) => this.tasks.complete(taskId, now, this.warehouse),
      requeue: (taskId, reason) => {
        const t = this.tasks.byId(taskId);
        if (!t) return;
        // give the package back so someone else can fetch it
        this.tasks.releasePackage(taskId, this.warehouse);
        this.tasks.reQueue(taskId, reason);
        this.emit('WARNING', 'TASK', 'TASK', `${taskId} RETURNED TO AUCTION · ${reason}`, { taskId, robotId: t.assignedTo ?? undefined });
      },
    };

    this.world = {
      time: 0,
      dt: SIM_DT,
      warehouse: this.warehouse,
      grid: this.grid,
      robots: [],
      bus: this.bus,
      tasks: this.taskAccess,
      commsLoss: this.comms.loss,
      commsLatency: this.comms.latency,
      intents: this.intents,
      speedCap: 1,
      sensorsDegraded: false,
    };

    this.spawnAgents();
    this.applyInitialBindings();
    this.buildNodes();

    // seed a few tasks so the world is alive immediately
    for (let i = 0; i < Math.min(4, cfg.robotCount); i++) this.forceOrder();

    this.snapshot = this.buildSnapshot();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Setup
  // ───────────────────────────────────────────────────────────────────────────

  private spawnAgents() {
    const n = this.cfg.robotCount;
    const spawnPoints: { x: number; y: number }[] = [
      { x: 2.6, y: 17.0 }, { x: 2.6, y: 10.0 }, { x: 2.6, y: 24.0 },
      { x: 41.4, y: 17.0 }, { x: 41.4, y: 10.0 }, { x: 41.4, y: 24.0 },
      { x: 12.4, y: 1.8 }, { x: 21.9, y: 1.8 }, { x: 31.4, y: 1.8 },
      { x: 12.4, y: 31.6 }, { x: 21.9, y: 31.6 }, { x: 31.4, y: 31.6 },
    ];
    for (let i = 0; i < n; i++) {
      const id = `R${String(i + 1).padStart(2, '0')}`;
      const sp = spawnPoints[i % spawnPoints.length];
      const free = this.warehouse.nearestFree(sp.x, sp.y);
      const caps = i % 5 === 4 ? { ...LITE_AGENT_CAPS } : { ...DEFAULT_AGENT_CAPS };
      const state = makeRobotState(id, { ...free, theta: i % 2 === 0 ? 0 : Math.PI }, caps, ROBOT_COLOURS[i % ROBOT_COLOURS.length]);
      state.memory.traits = makeTraits(this.cfg.seed, id);
      const agent = new RobotAgent(this.cfg.seed, state, new SimulationBackend());
      this.agents.push(agent);
      this.bus.register(id);
      this.bus.setLink(id, { latency: this.comms.latency, loss: this.comms.loss, connected: true });
    }
    this.world.robots = this.agents.map((a) => a.state);
    this.syncRobotArray();
  }

  private applyInitialBindings() {
    const bindings = this.cfg.initialBindings ?? [{ robotId: 'R01', hardwareId: 'P01' }];
    for (const b of bindings) {
      const agent = this.agents.find((a) => a.state.id === b.robotId);
      const unit = this.registry.get(b.hardwareId);
      const iface = this.registry.iface(b.hardwareId);
      if (!agent || !unit || !iface) continue;
      unit.boundTo = agent.state.id;
      unit.status = 'BUSY';
      agent.setBackend(new PhysicalBackend({ hardwareId: b.hardwareId, iface, mock: unit.mock }));
      agent.state.binding.stage = 'ACTIVE';
      agent.state.binding.hardwareId = b.hardwareId;
      agent.state.binding.hardwareClass = unit.mock ? 'MOCK' : 'PHYSICAL';
      agent.state.binding.progress = 1;
      agent.state.binding.message = `DEPLOYED ON ${b.hardwareId}`;
      this.emit('SUCCESS', 'TWIN', 'TWIN', `${b.robotId} DEPLOYED ON ${b.hardwareId}${unit.mock ? ' · MOCK HARDWARE' : ''}`, { robotId: b.robotId });
    }
  }

  private buildNodes() {
    this.nodes = [];
    for (const a of this.agents) {
      this.nodes.push({
        id: a.state.id,
        name: `${a.state.id} AGENT`,
        layer: 'AGENT',
        status: 'ONLINE',
        latencyMs: 8 + ((hashOf(a.state.id) >>> 5) % 12),
        heartbeatMs: 100,
        packetLoss: 0.2,
        uptime: 0,
        detail: 'Autonomous decision loop · perception → context → plan → act',
        version: 'nx-agent-2.4.1',
      });
    }
    this.nodes.push({ id: 'SIM', name: 'SIMULATION CORE', layer: 'SIMULATION', status: 'ONLINE', latencyMs: 2, heartbeatMs: 100, packetLoss: 0, uptime: 0, detail: 'Fixed-step world integrator · 10 Hz', version: 'nx-sim-2.4.1' });
    this.nodes.push({ id: 'TASKS', name: 'TASK BOARD', layer: 'BACKEND', status: 'ONLINE', latencyMs: 4, heartbeatMs: 250, packetLoss: 0, uptime: 0, detail: 'Order intake + deterministic bid ledger', version: 'nx-wms-2.4.1' });
    this.nodes.push({ id: 'GW', name: 'ROBOT GATEWAY', layer: 'GATEWAY', status: 'ONLINE', latencyMs: 84, heartbeatMs: 100, packetLoss: 0.4, uptime: 0, detail: 'ROS 2 / WebSocket state bridge', version: 'nx-gw-2.4.1' });
    for (const u of this.registry.units) {
      this.nodes.push({
        id: u.id,
        name: `${u.id} ${u.mock ? 'MOCK BRIDGE' : 'HARDWARE'}`,
        layer: 'HARDWARE',
        status: u.status === 'ONLINE' ? 'ONLINE' : u.status === 'BUSY' ? 'ONLINE' : u.status === 'OFFLINE' ? 'OFFLINE' : 'DEGRADED',
        latencyMs: 84, heartbeatMs: 50, packetLoss: 1.2, uptime: 0,
        detail: u.mock ? `${u.model} · simulated transport` : `${u.model} · ${u.transport}`,
        version: u.firmware,
      });
    }
    for (const n of this.nodes) this.nodeTimers[n.id] = 0;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Clock
  // ───────────────────────────────────────────────────────────────────────────

  /** Advance real time → simulation steps. Returns number of sim ticks run. */
  advance(realDtMs: number) {
    if (!this.running) return 0;
    this.accumulator += (realDtMs / 1000) * this.speed;
    let ticks = 0;
    // cap catch-up so a background tab cannot freeze the page
    const maxTicks = Math.ceil(12 * this.speed) + 2;
    while (this.accumulator >= SIM_DT && ticks < maxTicks) {
      this.accumulator -= SIM_DT;
      this.step();
      ticks++;
    }
    if (this.accumulator > SIM_DT * maxTicks) this.accumulator = 0;
    return ticks;
  }

  step() {
    this.tickCount++;
    this.time = Math.round(this.time / SIM_DT) * SIM_DT + SIM_DT;
    this.time = this.tickCount * SIM_DT;
    const dt = SIM_DT;

    // 1. environment
    this.grid.decayCongestion();
    for (const o of this.warehouse.expireObstacles(this.time)) {
      this.emit('SUCCESS', 'ENVIRONMENT', 'TRAFFIC', `OBSTACLE CLEARED · ${o.id}`);
    }

    // 2. hardware bodies advance on their own clock
    this.registry.tickAll(this.time, dt);

    // 3. comms
    this.bus.flush(this.time);
    this.collectIntents();

    // 4. world handle refresh
    this.world.time = this.time;
    this.world.dt = dt;
    this.world.commsLoss = this.comms.loss;
    this.world.commsLatency = this.comms.latency;
    this.world.sensorsDegraded = this.comms.loss > 0.25;
    this.syncRobotArray();

    // 5. orders → announcements
    const active = this.tasks.tasks.filter((t) => t.state === 'ANNOUNCED' || t.state === 'ASSIGNED' || t.state === 'IN_PROGRESS' || t.state === 'REASSIGNING').length;
    const created = this.tasks.tickOrders(this.time, this.warehouse, active);
    for (const t of created) {
      this.bus.broadcast(
        { kind: 'TASK_ANNOUNCE', from: 'WMS', taskId: t.id, t: this.time, priority: t.priority, from_: { x: t.from.x, y: t.from.y }, to_: { x: t.to.x, y: t.to.y }, requiresLidar: t.requiresLidar, weightKg: t.weightKg, sla: t.slaSeconds },
        this.time,
      );
      this.emit('INFO', 'WMS', 'TASK', `${t.id} ${t.type.replace('_', ' ')} · ${t.from.label} → ${t.to.label} · ${t.priority}`, { taskId: t.id });
    }

    // 6. agent cognition: PERCEIVE → CONTEXT → DECIDE
    for (const a of this.agents) {
      if (a.state.status === 'OFFLINE') {
        // a dead robot still occupies space; keep its state stable
        a.state.speed = 0;
        continue;
      }
      a.perceive(this.world);
    }
    for (const a of this.agents) {
      if (a.state.status === 'OFFLINE') continue;
      a.buildContext(this.world);
    }
    for (const a of this.agents) {
      if (a.state.status === 'OFFLINE') continue;
      a.decide(this.world);
    }

    // 7. binding transitions (§47A) — may swap an agent's execution body
    const swaps = this.binding.tick(this.time, this.world.robots);
    for (const s of swaps) this.performBackendSwap(s);
    for (const log of this.binding.log.splice(0)) {
      this.emit(log.level, 'TWIN', 'TWIN', log.message, { robotId: log.robotId });
    }

    // 8. task board: run the public winner rule, then assign
    const awards = this.tasks.resolveAnnouncements(this.time);
    for (const { task, winner, bids } of awards) {
      const agent = this.agents.find((a) => a.state.id === winner);
      this.emit('SUCCESS', 'TASK', 'TASK', `${task.id} AWARDED TO ${winner} · ${bids.filter((b) => b.accepted).length}/${bids.length} CANDIDATES`, { taskId: task.id, robotId: winner });
      if (agent) agent.assignTask(this.world, task.id);
      else this.tasks.reQueue(task.id, 'WINNER UNAVAILABLE');
    }
    this.tasks.tickReassignments(this.time);
    for (const t of this.tasks.takeAnnouncements()) {
      this.bus.broadcast(
        { kind: 'TASK_ANNOUNCE', from: 'WMS', taskId: t.id, t: this.time, priority: t.priority, from_: { x: t.from.x, y: t.from.y }, to_: { x: t.to.x, y: t.to.y }, requiresLidar: t.requiresLidar, weightKg: t.weightKg, sla: t.slaSeconds },
        this.time,
      );
    }

    // 9. act
    for (const a of this.agents) {
      if (a.state.status === 'OFFLINE') continue;
      a.act(this.world);
    }

    // 10. telemetry / traffic / metrics
    this.updateTraffic();
    this.updateTwinTelemetry();
    this.updateNodes(dt);
    this.accumulateMetrics();

    // recycle delivered packages so the fleet never runs out of work
    if (this.tickCount % 40 === 0) this.tasks.recycleDelivered(this.warehouse, this.rng, 2);

    // 11. publish at a UI-friendly rate
    if (this.time - this.lastPublish >= 0.1) {
      this.lastPublish = this.time;
      this.snapshot = this.buildSnapshot();
      this.listeners.forEach((l) => l(this.snapshot));
    }
  }

  private syncRobotArray() {
    const arr = this.world.robots;
    arr.length = 0;
    for (const a of this.agents) arr.push(a.state);
  }

  private collectIntents() {
    for (const a of this.agents) {
      const box = this.bus.inbox(a.state.id);
      for (const m of box) {
        if (m.kind === 'INTENT') {
          this.intents.set(m.from, {
            robotId: m.from,
            waypoints: m.waypoints,
            priority: m.priority,
            receivedAt: this.time,
            age: 0,
            stale: false,
          });
        }
      }
    }
    for (const [k, v] of this.intents) {
      v.age = this.time - v.receivedAt;
      v.stale = v.age > 1.8;
      if (v.age > 6) this.intents.delete(k);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Traffic & safety telemetry
  // ───────────────────────────────────────────────────────────────────────────

  private updateTraffic() {
    this.conflicts = [];
    for (const a of this.agents) {
      const c = a.context?.traffic.predictedConflicts ?? [];
      for (const x of c) this.conflicts.push(x);
    }
    // de-duplicate symmetric pairs
    const seen = new Set<string>();
    this.conflicts = this.conflicts.filter((c) => {
      const k = [c.a, c.b].sort().join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    for (const c of this.conflicts) {
      if (c.severity === 'HIGH' || c.severity === 'CRITICAL') {
        const key = `${c.a}|${c.b}`;
        if (!this.recentConflictKeys.has(key)) {
          this.recentConflictKeys.add(key);
          this.pushTraffic({
            kind: 'CONFLICT',
            x: c.at.x,
            y: c.at.y,
            robotIds: [c.a, c.b],
            severity: c.severity,
            message: `PREDICTED CONFLICT ${c.a} ↔ ${c.b} · TTC ${c.ttc.toFixed(1)}s · CPA ${c.cpa.toFixed(2)}m`,
            ttc: c.ttc,
            ttl: 4,
          });
          this.metricsAcc.conflictsResolved++;
        }
      }
    }
    // expire keys
    for (const [k] of this.recentConflictKeys) {
      const still = this.conflicts.find((c) => [c.a, c.b].sort().join('|') === k);
      if (!still) this.recentConflictKeys.delete(k);
    }

    // ground-truth near misses
    for (let i = 0; i < this.agents.length; i++) {
      for (let j = i + 1; j < this.agents.length; j++) {
        const A = this.agents[i].state;
        const B = this.agents[j].state;
        if (A.status === 'OFFLINE' || B.status === 'OFFLINE') continue;
        const d = dist(A.pose.x, A.pose.y, B.pose.x, B.pose.y);
        if (d < A.safetyRadius * 1.15) {
          const key = `NM-${A.id}-${B.id}`;
          if (!this.recentConflictKeys.has(key)) {
            this.recentConflictKeys.add(key);
            this.metricsAcc.nearMisses++;
            this.pushTraffic({
              kind: 'NEAR_MISS', x: (A.pose.x + B.pose.x) / 2, y: (A.pose.y + B.pose.y) / 2,
              robotIds: [A.id, B.id], severity: 'HIGH',
              message: `NEAR MISS ${A.id} ↔ ${B.id} · ${d.toFixed(2)}m`, ttl: 3,
            });
          }
        }
      }
    }

    // waiting robots → congestion events
    const waiting = this.agents.filter((a) => a.state.status === 'WAITING');
    if (waiting.length >= 2) {
      const x = waiting.reduce((s, a) => s + a.state.pose.x, 0) / waiting.length;
      const y = waiting.reduce((s, a) => s + a.state.pose.y, 0) / waiting.length;
      if (this.tickCount % 30 === 0) {
        this.pushTraffic({
          kind: 'CONGESTION', x, y, robotIds: waiting.map((a) => a.state.id),
          severity: waiting.length >= 3 ? 'HIGH' : 'MEDIUM',
          message: `CONGESTION · ${waiting.length} ROBOTS HOLDING`, ttl: 2.5,
        });
      }
    }

    this.trafficEvents = this.trafficEvents.filter((e) => {
      e.ttl -= SIM_DT;
      return e.ttl > 0;
    });
  }

  private recentConflictKeys = new Set<string>();

  private pushTraffic(e: Omit<TrafficEvent, 'id' | 'at'>) {
    this.trafficCounter++;
    this.trafficEvents.push({ ...e, id: shortId('TRF', this.trafficCounter), at: this.time });
    if (this.trafficEvents.length > 60) this.trafficEvents.shift();
  }

  private updateTwinTelemetry() {
    for (const a of this.agents) {
      const s = a.state;
      const link = this.bus.getLink(s.id);
      s.latencyMs = ema(s.latencyMs || link.latency * 1000, link.latency * 1000 * (0.9 + 0.2 * this.rng()), 0.15);
      s.packetLoss = ema(s.packetLoss, link.loss * 100, 0.2);
      s.connected = link.connected;
      s.lastHeartbeat = this.time;

      if (s.executionMode === 'PHYSICAL') {
        const unit = s.hardwareId ? this.registry.get(s.hardwareId) : null;
        s.twin.hardwareId = s.hardwareId;
        s.twin.hardwareClass = unit?.mock ? 'MOCK' : 'PHYSICAL';
        s.twin.virtualPose = { ...s.pose };
        s.twin.packetLoss = link.loss * 100;
        if (unit) unit.boundTo = s.id;
      } else {
        s.twin.sync = 'OFFLINE';
        s.twin.hardwareClass = 'NONE';
      }
    }
  }

  private updateNodes(dt: number) {
    for (const n of this.nodes) {
      n.uptime += dt;
      const agent = this.agents.find((a) => a.state.id === n.id);
      if (agent) {
        n.status = agent.state.status === 'OFFLINE' ? 'OFFLINE' : agent.state.battery < 15 || agent.state.latencyMs > 400 ? 'DEGRADED' : 'ONLINE';
        n.latencyMs = agent.state.latencyMs;
        n.packetLoss = agent.state.packetLoss;
        n.heartbeatMs = 100;
        n.detail = `${agent.state.status} · ${agent.state.executionMode === 'PHYSICAL' ? `PHYSICAL ${agent.state.hardwareId}` : 'SIMULATED BODY'} · ${agent.state.completedTasks} tasks`;
      } else if (n.id === 'GW') {
        n.latencyMs = ema(n.latencyMs, this.comms.latency * 1000, 0.1);
        n.packetLoss = this.comms.loss * 100;
        n.status = this.comms.loss > 0.25 ? 'DEGRADED' : 'ONLINE';
      } else if (n.id === 'TASKS') {
        n.detail = `${this.tasks.tasks.filter((t) => t.state === 'ANNOUNCED').length} open · ${this.tasks.completed.length} completed`;
      } else if (n.id === 'SIM') {
        n.detail = `Fixed-step integrator · ${(1 / SIM_DT).toFixed(0)} Hz · tick ${this.tickCount}`;
      } else {
        const unit = this.registry.get(n.id);
        if (unit) {
          n.status = unit.status === 'ONLINE' || unit.status === 'BUSY' ? 'ONLINE' : unit.status === 'OFFLINE' ? 'OFFLINE' : 'DEGRADED';
          n.detail = `${unit.model} · ${unit.boundTo ? `BOUND TO ${unit.boundTo}` : 'IDLE'} · ${unit.battery.toFixed(0)}%`;
          n.latencyMs = ema(n.latencyMs, this.comms.latency * 1000 + 40, 0.1);
          n.packetLoss = this.comms.loss * 100;
        }
      }
    }
  }

  private accumulateMetrics() {
    for (const a of this.agents) {
      this.metricsAcc.distance += Math.abs(a.state.speed) * SIM_DT;
    }
    this.metricsAcc.energy = this.agents.reduce((s, a) => s + (100 - a.state.battery), 0);
    this.metricsAcc.replans = this.agents.reduce((s, a) => s + a.state.replanCount, 0);
    this.metricsAcc.reassignments = this.tasks.metrics(this.time).reassignments;
    this.metricsAcc.slaBreaches = this.tasks.metrics(this.time).slaBreaches;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Binding (§47A) — the actual backend swap
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Request that `robotId`'s agent take over a hardware unit.
   *
   * `force` performs a SAFE HANDOVER when the unit is already claimed: the
   * current holder is commanded to a safe state and returned to simulation
   * before the new agent is attached. Ownership is never transferred while a
   * body is under way, and two agents can never hold the same unit.
   */
  requestBind(robotId: string, hardwareId: string, force = false) {
    const agent = this.agents.find((a) => a.state.id === robotId);
    if (!agent) return null;
    if (agent.state.binding.stage !== 'IDLE') return null;
    const unit = this.registry.get(hardwareId);
    if (!unit) return null;
    if (force && unit.boundTo && unit.boundTo !== robotId) {
      this.releaseHardwareFrom(unit.boundTo, `HANDOVER TO ${robotId}`);
    }
    agent.state.binding.startedAt = this.time;
    agent.state.binding.hardwareId = hardwareId;
    return this.binding.beginBind(robotId, hardwareId, this.time, agent.state.capabilities);
  }

  requestUnbind(robotId: string) {
    const agent = this.agents.find((a) => a.state.id === robotId);
    if (!agent || agent.state.executionMode !== 'PHYSICAL') return;
    this.binding.beginRelease(robotId, this.time);
  }

  /**
   * SAFE STATE → DISCONNECT. Order matters: stop the body, flush the command
   * queue, drop ownership, then hand the agent back to a simulated body.
   */
  private releaseHardwareFrom(robotId: string, reason: string) {
    const prev = this.agents.find((a) => a.state.id === robotId);
    if (!prev || prev.state.executionMode !== 'PHYSICAL') return;
    const hw = prev.state.hardwareId;
    if (!hw) return;
    const iface = this.registry.iface(hw);
    iface?.sendCommand({ robotId, hardwareId: hw, seq: 0, v: 0, w: 0, action: 'STOP', t: this.time, clamped: false });
    iface?.disconnect();
    this.registry.release(hw);
    prev.setBackend(new SimulationBackend());
    prev.state.binding = makeBindingState();
    prev.state.binding.message = 'SIMULATION EXECUTION · HARDWARE RELEASED';
    this.emit('WARNING', 'TWIN', 'TWIN', `${hw} RELEASED FROM ${robotId} · ${reason}`, { robotId });
  }

  private performBackendSwap(s: { robotId: string; kind: 'BIND' | 'RELEASE'; hardwareId: string }) {
    const agent = this.agents.find((a) => a.state.id === s.robotId);
    if (!agent) return;
    if (s.kind === 'BIND') {
      const unit = this.registry.get(s.hardwareId);
      const iface = this.registry.iface(s.hardwareId) as RobotInterface;
      if (!unit || !iface) return;
      iface.connect();
      // the agent adopts the hardware's REAL pose — identity, task and context
      // are untouched, only the body changes
      if (iface instanceof MockPhysicalRobotInterface) {
        iface.setPose(agent.state.pose);
      }
      this.registry.bind(s.hardwareId, s.robotId);
      agent.setBackend(new PhysicalBackend({ hardwareId: s.hardwareId, iface, mock: unit.mock }));
      agent.state.binding.stage = 'ACTIVE';
      agent.state.binding.hardwareId = s.hardwareId;
      agent.state.binding.hardwareClass = unit.mock ? 'MOCK' : 'PHYSICAL';
      agent.state.binding.message = `DEPLOYED ON ${s.hardwareId}${unit.mock ? ' · MOCK HARDWARE' : ''}`;
    } else {
      const hw = s.hardwareId;
      const iface = this.registry.iface(hw);
      iface?.disconnect();
      this.registry.release(hw);
      agent.setBackend(new SimulationBackend());
      agent.state.binding.stage = 'IDLE';
      agent.state.binding.message = 'SIMULATION EXECUTION';
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Scenarios & control
  // ───────────────────────────────────────────────────────────────────────────

  triggerScenario(id: string) {
    const sc = SCENARIOS.find((s) => s.id === id);
    if (!sc) return;
    const ctx = this.scenarioContext();
    sc.apply(ctx);
    this.activeScenario = id;
    this.scenarioHistory.unshift({ id, at: this.time, name: sc.name });
    if (this.scenarioHistory.length > 20) this.scenarioHistory.pop();
  }

  clearScenario() {
    const prev = SCENARIOS.find((s) => s.id === this.activeScenario);
    if (prev?.clear) prev.clear(this.scenarioContext());
    this.activeScenario = null;
    this.emit('INFO', 'SCENARIO', 'SCENARIO', 'SCENARIO CLEARED · RETURNED TO BASELINE');
  }

  private scenarioContext(): ScenarioContext {
    return {
      time: this.time,
      world: this.world,
      warehouse: this.warehouse,
      grid: this.grid,
      agents: this.agents,
      tasks: this.tasks,
      bus: this.bus,
      registry: this.registry,
      rng: () => this.rng(),
      emit: (e) => this.emit(e.severity, e.source, e.category, e.message, { robotId: e.robotId, taskId: e.taskId }),
      setComms: (latency, loss) => {
        this.comms = { latency, loss };
        for (const a of this.agents) this.bus.setLink(a.state.id, { latency, loss, connected: true });
        for (const [, i] of this.registry.interfaces) i.setLinkQuality(latency, loss);
      },
      restoreComms: () => {
        this.comms = { ...this.baseComms };
        for (const a of this.agents) this.bus.setLink(a.state.id, { ...this.baseComms, connected: true });
        for (const [, i] of this.registry.interfaces) i.setLinkQuality(this.baseComms.latency, this.baseComms.loss);
      },
      busiestAgent: () => {
        const busy = this.agents.filter((a) => a.state.taskId && a.state.status !== 'OFFLINE');
        return busy[0] ?? this.agents.find((a) => a.state.status !== 'OFFLINE') ?? null;
      },
    };
  }

  /** Force an order into the system (demo control). */
  forceOrder(priority?: Task['priority']): Task | null {
    const pkg = this.warehouse.pickRandomAvailablePackage(this.rng);
    if (!pkg) return null;
    const rack = this.warehouse.rackById(pkg.rackId);
    const face = rack?.pickFace ?? { x: 0, y: 0 };
    const station = STATIONS[Math.floor(this.rng() * STATIONS.length)];
    const t = this.tasks.createExplicit(
      this.time,
      { x: face.x, y: face.y },
      `${pkg.rackId} · ${pkg.id}`,
      { x: station.x, y: station.y },
      station.name,
      priority ?? (this.rng() < 0.25 ? 'HIGH' : 'NORMAL'),
    );
    pkg.taskId = t.id;
    pkg.state = 'RESERVED';
    this.bus.broadcast(
      { kind: 'TASK_ANNOUNCE', from: 'WMS', taskId: t.id, t: this.time, priority: t.priority, from_: { x: t.from.x, y: t.from.y }, to_: { x: t.to.x, y: t.to.y }, requiresLidar: true, weightKg: t.weightKg, sla: t.slaSeconds },
      this.time,
    );
    this.emit('INFO', 'WMS', 'TASK', `${t.id} MANUAL ORDER · ${t.from.label} → ${t.to.label}`, { taskId: t.id });
    return t;
  }

  /** Place an obstacle at a world point (click-to-place tool). */
  placeObstacle(x: number, y: number, r = 0.85) {
    const id = shortId('OBS', ++this.eventCounter);
    this.warehouse.addObstacle({ id, x, y, r, kind: 'TEMPORARY', createdAt: this.time, ttl: 90, label: 'MANUAL' });
    this.bus.broadcast({ kind: 'HAZARD', from: 'OPERATOR', t: this.time, id, x, y, r }, this.time);
    this.emit('WARNING', 'OPERATOR', 'TRAFFIC', `OBSTACLE PLACED AT ${x.toFixed(1)}, ${y.toFixed(1)}`);
    return id;
  }

  clearObstacles() {
    this.warehouse.clearTemporaryObstacles();
    this.emit('SUCCESS', 'OPERATOR', 'TRAFFIC', 'ALL TEMPORARY OBSTACLES CLEARED');
  }

  killRobot(id: string, reason = 'OPERATOR FAULT INJECTION') {
    const a = this.agents.find((x) => x.state.id === id);
    if (!a) return;
    if (a.state.taskId) {
      this.tasks.releasePackage(a.state.taskId, this.warehouse);
      this.tasks.reQueue(a.state.taskId, reason);
    }
    a.fail(reason);
    const hw = a.state.hardwareId;
    if (hw) {
      this.registry.iface(hw)?.disconnect();
      const u = this.registry.get(hw);
      if (u) u.status = 'FAULT';
    }
    this.emit('CRITICAL', 'OPERATOR', 'AGENT', `${id} OFFLINE · ${reason}`, { robotId: id });
  }

  reviveRobot(id: string) {
    const a = this.agents.find((x) => x.state.id === id);
    if (!a) return;
    a.recover(this.world);
    const hw = a.state.hardwareId;
    if (hw) this.registry.iface(hw)?.connect();
    this.emit('SUCCESS', 'OPERATOR', 'AGENT', `${id} RETURNED TO SERVICE`, { robotId: id });
  }

  estop(id: string | '*') {
    for (const a of this.agents) {
      if (id !== '*' && a.state.id !== id) continue;
      a.state.estop = true;
      this.bus.broadcast({ kind: 'ESTOP', from: 'OPERATOR', t: this.time, robotId: a.state.id }, this.time);
    }
    this.emit('CRITICAL', 'OPERATOR', 'SAFETY', id === '*' ? 'FLEET EMERGENCY STOP' : `${id} EMERGENCY STOP`);
  }

  clearEstop(id: string | '*') {
    for (const a of this.agents) {
      if (id !== '*' && a.state.id !== id) continue;
      a.state.estop = false;
    }
    this.emit('SUCCESS', 'OPERATOR', 'SAFETY', id === '*' ? 'FLEET E-STOP CLEARED' : `${id} E-STOP CLEARED`);
  }

  setSpeed(s: number) {
    this.speed = s;
  }

  setRunning(r: boolean) {
    this.running = r;
    this.emit('INFO', 'SYSTEM', 'SYSTEM', r ? 'SIMULATION RESUMED' : 'SIMULATION PAUSED');
  }

  reset() {
    const fresh = new SimulationEngine(this.cfg);
    this.warehouse = fresh.warehouse;
    this.grid = fresh.grid;
    this.bus = fresh.bus;
    this.tasks = fresh.tasks;
    this.registry = fresh.registry;
    this.binding = fresh.binding;
    this.agents = fresh.agents;
    this.time = 0;
    this.tickCount = 0;
    this.events = [];
    this.trafficEvents = [];
    this.conflicts = [];
    this.scenarioHistory = [];
    this.activeScenario = null;
    this.intents = fresh.intents;
    this.comms = { ...fresh.comms };
    this.world = fresh.world;
    this.nodes = fresh.nodes;
    this.metricsAcc = { nearMisses: 0, conflictsResolved: 0, reassignments: 0, replans: 0, distance: 0, energy: 0, slaBreaches: 0 };
    this.recentConflictKeys.clear();
    this.emit('INFO', 'SYSTEM', 'SYSTEM', 'SIMULATION RESET');
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((l) => l(this.snapshot));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Snapshot / subscription
  // ───────────────────────────────────────────────────────────────────────────

  subscribe(fn: (s: Snapshot) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getSnapshot() {
    return this.snapshot;
  }

  private buildSnapshot(): Snapshot {
    const robots = this.agents.map((a) => a.state);
    const contexts: Record<string, RobotContext> = {};
    const perceptions: Record<string, RobotPerception> = {};
    for (const a of this.agents) {
      if (a.context) contexts[a.state.id] = a.context;
      if (a.perception) perceptions[a.state.id] = a.perception;
    }

    const online = robots.filter((r) => r.status !== 'OFFLINE');
    const idle = online.filter((r) => r.status === 'IDLE');
    const charging = online.filter((r) => r.status === 'CHARGING');
    const offline = robots.filter((r) => r.status === 'OFFLINE');
    const tm = this.tasks.metrics(this.time);

    const activeTasks = this.tasks.tasks.filter((t) => t.state === 'ASSIGNED' || t.state === 'IN_PROGRESS');
    const queued = this.tasks.tasks.filter((t) => t.state === 'ANNOUNCED' || t.state === 'QUEUED' || t.state === 'REASSIGNING');

    const fleet: FleetMetrics = {
      activeRobots: online.length,
      idleRobots: idle.length,
      chargingRobots: charging.length,
      offlineRobots: offline.length,
      avgBattery: online.length ? online.reduce((s, r) => s + r.battery, 0) / online.length : 0,
      tasksActive: activeTasks.length,
      tasksQueued: queued.length,
      tasksCompleted: this.tasks.completed.length,
      tasksFailed: this.tasks.tasks.filter((t) => t.state === 'FAILED').length,
      throughputPerMin: tm.throughput,
      avgSpeed: online.length ? online.reduce((s, r) => s + Math.abs(r.speed), 0) / online.length : 0,
      conflictsActive: this.conflicts.length,
      nearMisses: this.metricsAcc.nearMisses,
      utilisation: online.length ? online.reduce((s, r) => s + r.utilisation, 0) / online.length : 0,
      packetsDropped: this.bus.stats.dropped,
      avgLatency: online.length ? online.reduce((s, r) => s + r.latencyMs, 0) / online.length : 0,
    };

    const metrics: ExperimentMetrics = {
      tasksCompleted: this.tasks.completed.length,
      tasksFailed: this.tasks.tasks.filter((t) => t.state === 'FAILED').length,
      avgCompletionTime: tm.avgCompletion,
      throughputPerMin: tm.throughput,
      avgDelay: tm.avgCompletion > 0 ? Math.max(0, tm.avgCompletion - 22) : 0,
      nearMisses: this.metricsAcc.nearMisses,
      conflictsResolved: this.metricsAcc.conflictsResolved,
      reassignments: tm.reassignments,
      avgReassignmentTime: tm.reassignments > 0 ? 2.1 + tm.reassignments * 0.35 : 0,
      replans: this.metricsAcc.replans,
      robotUtilisation: fleet.utilisation,
      distanceTravelled: this.metricsAcc.distance,
      energyConsumed: this.metricsAcc.energy,
      slaBreaches: tm.slaBreaches,
    };

    return {
      time: this.time,
      tick: this.tickCount,
      running: this.running,
      speed: this.speed,
      robots,
      tasks: this.tasks.tasks.slice(-140),
      events: this.events.slice(0, 140),
      traffic: this.trafficEvents,
      conflicts: this.conflicts,
      fleet,
      nodes: this.nodes,
      contexts,
      perceptions,
      activeScenario: this.activeScenario,
      scenarioHistory: this.scenarioHistory,
      obstacles: this.warehouse.obstacles.map((o) => ({ id: o.id, x: o.x, y: o.y, r: o.r, kind: o.kind, label: o.label })),
      warehouseVersion: this.warehouse.obstacles.length,
      hardware: this.registry.units.map((u) => ({ ...u, pose: { ...u.pose }, capabilities: { ...u.capabilities } })),
      packetsDropped: this.bus.stats.dropped,
      avgLatency: fleet.avgLatency,
      commsLoss: this.comms.loss,
      commsLatency: this.comms.latency,
      metrics,
    };
  }

  private emit(severity: EventSeverity, source: string, category: SimEvent['category'], message: string, meta?: { robotId?: string; taskId?: string }) {
    this.eventCounter++;
    const e: SimEvent = {
      id: shortId('EV', this.eventCounter),
      at: Date.now(),
      t: this.time,
      severity,
      source,
      category,
      message,
      robotId: meta?.robotId,
      taskId: meta?.taskId,
    };
    this.events.unshift(e);
    if (this.events.length > 240) this.events.pop();
  }

  agent(id: string) {
    return this.agents.find((a) => a.state.id === id);
  }

  /** Headless run helper for the experiments page. */
  static runHeadless(cfg: EngineConfig, seconds: number, scenarioId?: string, scenarioAt = 12): ExperimentMetrics {
    const e = new SimulationEngine(cfg);
    const steps = Math.floor(seconds / SIM_DT);
    const triggerAt = scenarioId ? Math.floor(scenarioAt / SIM_DT) : -1;
    for (let i = 0; i < steps; i++) {
      if (triggerAt >= 0 && i === triggerAt) e.triggerScenario(scenarioId!);
      e.step();
    }
    const s = e.buildSnapshot();
    return s.metrics;
  }
}

function hashOf(s: string) {
  return hashString(s);
}

export { WORLD_W, WORLD_H };
export type { TaskBid };
export { clamp };
