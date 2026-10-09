/**
 * ROBOT AGENT — an independent, context-aware, autonomous decision-maker.
 *
 * PHASE 1 + 3 + 4 of the build order live here. Every instance owns:
 *   • its own state          (RobotState)
 *   • its own perception     (RobotPerception — built by its own sensors)
 *   • its own context        (RobotContext — derived, never shared)
 *   • its own planner        (A* over its own belief costmap)
 *   • its own decision rule  (this file)
 *   • its own execution body (SimulationBackend | PhysicalBackend)
 *
 * The loop, run independently per tick for every agent:
 *
 *   PERCEIVE → UNDERSTAND CONTEXT → EVALUATE → PLAN → SELECT ACTION
 *            → EXECUTE → OBSERVE RESULT → UPDATE CONTEXT → REPLAN
 *
 * There is no shared brain. Nothing here reads another agent's context.
 */

import type {
  DecisionKind,
  DetectedRobot,
  Obstacle,
  Path,
  PathPoint,
  RobotAction,
  RobotContext,
  RobotDecision,
  RobotPerception,
  RobotState,
  Task,
  TaskBid,
  Vec2,
} from '../types';
import type { Warehouse } from '../environment/warehouse';
import type { OccupancyGrid } from '../environment/grid';
import type { CommsBus, Message } from '../communication/bus';
import { perceive, evaluatePlanAgainstBeliefs, type WorldTruth } from '../perception/perception';
import { buildContext } from './context';
import { planAStar, type CostView } from '../planning/astar';
import { computeMotion, type MotionCommand } from '../navigation/controller';
import { deadlockBreaker, predictConflicts, rightOfWay, safetyBrake, type SelfSnapshot } from '../collision/collision';
import { computeBid, type AnnouncePayload } from '../tasks/allocation';
import { SimulationBackend, PhysicalBackend, makeTwin, type BackendWorldView, type RobotExecutionBackend } from '../robots/backend';
import { makeBindingState } from '../robots/binding';
import { WORLD_W, WORLD_H } from '../environment/warehouse';
import { clamp, dist, ema, wrapAngle } from '../core/math';
import { entityRng, type Rng } from '../core/rng';
import { shortId } from '../core/ids';

export interface TaskAccess {
  get(id: string): Task | undefined;
  openAnnouncements(): Task[];
  submitEvaluation(robotId: string, taskId: string, bid: TaskBid | null, reason: string | undefined, at: number): void;
  begin(taskId: string, now: number): void;
  complete(taskId: string, now: number): void;
  requeue(taskId: string, reason: string): void;
}

export interface AgentWorld {
  time: number;
  dt: number;
  warehouse: Warehouse;
  grid: OccupancyGrid;
  /** global truth (agents may only touch this through `perceive`) */
  robots: RobotState[];
  bus: CommsBus;
  tasks: TaskAccess;
  commsLoss: number;
  commsLatency: number;
  intents: Map<string, { robotId: string; waypoints: { x: number; y: number; t: number }[]; priority: number; receivedAt: number; age: number; stale: boolean }>;
  speedCap: number;
  sensorsDegraded: boolean;
}

const CRUISE = 0.85;
const REPLAN_CHECK_INTERVAL = 1.1;
const INTENT_INTERVAL = 0.45;
const TRAIL_INTERVAL = 0.35;
const PICK_DWELL = 1.3;
const DROP_DWELL = 1.0;
const ARRIVE_EPS = 0.5;
const MAX_TRAIL = 220;

export class RobotAgent {
  state: RobotState;
  context: RobotContext | null = null;
  perception: RobotPerception | null = null;
  backend: RobotExecutionBackend;

  private rng: Rng;
  private planCounter = 0;
  private pickTimer = 0;
  private dropTimer = 0;
  private lastIntentAt = -99;
  private lastTrailAt = -99;
  private lastReplanCheck = -99;
  private lastAnnounceSeen = new Set<string>();
  private targetKey = '';
  private cmd: MotionCommand = { v: 0, w: 0, arrived: false, cursor: 0, remaining: 0, alpha: 0, why: 'INIT' };
  private throttle = 1;
  private holdSince: number | null = null;
  private offlineAt: number | null = null;
  private chargingStationId: string | null = null;
  private lastStatus: RobotState['status'] = 'IDLE';
  private idleBlockedSince: number | null = null;
  private stepAsideCooldownUntil = 0;
  private steppingAsideUntil = 0;
  /** when a working agent had to dodge, it must resume its own task after */
  private resumeTaskAfterEvasion = false;
  private lastBypassAt = -99;
  private reverseUntil = 0;
  private lastRemaining: number | null = null;
  private noProgressSince = 0;

  constructor(seed: number, init: RobotState, startBackend?: RobotExecutionBackend) {
    this.state = init;
    this.rng = entityRng(seed, init.id);
    this.backend = startBackend ?? new SimulationBackend();
    this.state.trail = [];
    this.state.planHistory = [];
    this.state.decisionHistory = [];
    this.state.twin = makeTwin(init.id);
    this.state.binding = makeBindingState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. PERCEIVE
  // ─────────────────────────────────────────────────────────────────────────

  perceive(world: AgentWorld) {
    const truth: WorldTruth = {
      time: world.time,
      grid: world.grid,
      warehouse: world.warehouse,
      robots: world.robots,
      intents: world.intents,
      commsLoss: world.commsLoss,
      commsLatency: world.commsLatency,
    };
    this.perception = perceive(this.state, truth, this.rng, {
      degraded: world.sensorsDegraded || this.state.twin.sync === 'LOST',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. UNDERSTAND CONTEXT
  // ─────────────────────────────────────────────────────────────────────────

  buildContext(world: AgentWorld) {
    const task = this.state.taskId ? world.tasks.get(this.state.taskId) ?? null : null;
    const snap = this.snapshot();
    const conflicts = predictConflicts(
      snap,
      this.perception!.detectedRobots,
      { horizon: 4.0, safetyRadius: this.state.safetyRadius, range: 8 },
      world.time,
      this.rng,
    );
    this.context = buildContext({
      self: this.state,
      perception: this.perception!,
      warehouse: world.warehouse,
      task,
      conflicts,
      time: world.time,
      comms: {
        connected: this.state.connected,
        latencyMs: this.state.latencyMs,
        packetLoss: this.state.packetLoss,
        degraded: world.commsLoss > 0.15 || !this.state.connected,
      },
      cruiseSpeed: CRUISE,
    });
    // cache conflicts on the context for the UI
    this.context.traffic.predictedConflicts = conflicts;

    // Blocked-plan evaluation is perception-driven: the agent checks ITS OWN
    // route against ITS OWN beliefs.
    const lookahead = clamp(1.6 + this.state.speed * 3.2, 2.0, 7.5);
    const res = evaluatePlanAgainstBeliefs(this.state, this.perception!, world.grid, lookahead);
    this.perception!.blockedPlanCells = res.blockedIndices;
    this.context.obstacles.planBlocked = res.blocked;
    this.context.obstacles.blockedCells = res.blockedIndices.length;
    this.context.obstacles.ahead = res.obstacleAhead;
    this.context.self.planValid = !res.blocked;

    // remember what I personally saw, so my future plans avoid it even after
    // I can no longer see it (this is per-agent memory, not shared state)
    for (const o of this.perception!.detectedObstacles) {
      const c = world.grid.worldToCell(o.x, o.y);
      const r = Math.ceil((o.r + 0.4) / world.grid.spec.cell);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          this.state.memory.knownBlocked.set(`${c.ix + dx},${c.iy + dy}`, world.time);
        }
    }
    // forget stale beliefs
    if (this.state.memory.knownBlocked.size > 900) {
      for (const [k, t] of this.state.memory.knownBlocked) {
        if (world.time - t > 45) this.state.memory.knownBlocked.delete(k);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. EVALUATE + 4. PLAN + 5. SELECT ACTION
  // ─────────────────────────────────────────────────────────────────────────

  decide(world: AgentWorld): RobotDecision {
    const s = this.state;
    const ctx = this.context!;
    const task = s.taskId ? world.tasks.get(s.taskId) ?? null : null;

    // ── process the inbox (task announcements, hazards, peer claims) ─────────
    this.processInbox(world);

    // ── hard overrides ─────────────────────────────────────────────────────
    if (s.estop) return this.commit(world, 'HOLD', { type: 'ESTOP', v: 0, w: 0 }, 'E-STOP LATCHED', []);
    if (s.status === 'OFFLINE') {
      this.offlineAt = this.offlineAt ?? world.time;
      return this.commit(world, 'IDLE', { type: 'STOP', v: 0, w: 0 }, 'AGENT OFFLINE', []);
    }
    if (s.binding.stage !== 'IDLE' && s.binding.stage !== 'ACTIVE') {
      return this.commit(world, 'HOLD', { type: 'HOLD_POSITION', v: 0, w: 0 }, `BINDING · ${s.binding.message}`, [
        { label: 'STAGE', value: s.binding.stage },
      ]);
    }
    if (s.binding.stage === 'ACTIVE' && s.twin.sync === 'LOST') {
      return this.commit(world, 'HOLD', { type: 'HOLD_POSITION', v: 0, w: 0 }, 'TELEMETRY LOST · HOLDING', [
        { label: 'AGE', value: `${s.twin.telemetryAge.toFixed(2)}s` },
      ]);
    }

    // ── energy autonomy: each robot decides for ITSELF when to charge ───────
    if (s.status === 'CHARGING') {
      s.battery = clamp(s.battery + 3.6 * world.dt, 0, 100);
      if (s.battery > 96) {
        this.releaseCharger(world);
        s.status = 'IDLE';
        s.navState = 'NO_PLAN';
        return this.commit(world, 'CONTINUE', { type: 'STOP', v: 0, w: 0 }, 'CHARGE COMPLETE · RETURNING TO SERVICE', [{ label: 'BATTERY', value: `${s.battery.toFixed(0)}%` }]);
      }
      return this.commit(world, 'CHARGE', { type: 'CHARGE', v: 0, w: 0 }, `CHARGING · ${s.battery.toFixed(0)}%`, [
        { label: 'BATTERY', value: `${s.battery.toFixed(0)}%` },
        { label: 'THRESHOLD', value: `${(s.memory.traits.chargeThreshold * 100).toFixed(0)}%` },
      ]);
    }

    const needsCharge = s.battery < s.memory.traits.chargeThreshold * 100;
    const criticalBattery = s.battery < 14;

    if (criticalBattery && task && s.carryingPackageId) {
      // cannot abandon a package in the aisle — finish the drop first
      if (task.phase === 'TO_PICK') {
        world.tasks.requeue(task.id, 'BATTERY CRITICAL BEFORE PICKUP');
        this.detachTask(world, 'BATTERY CRITICAL');
      }
    } else if (needsCharge && !task) {
      return this.goCharge(world, ctx.energy.distanceToNearestCharger);
    }

    // ── task execution ─────────────────────────────────────────────────────
    if (task) {
      const r = this.executeTask(world, task);
      if (r) return r;
    } else if (needsCharge) {
      return this.goCharge(world, ctx.energy.distanceToNearestCharger);
    }

    // ── idle: hold at position, but get out of the way when asked ───────────
    if (!task) {
      // A. follow through on an evasive manoeuvre already under way
      if (this.steppingAsideUntil > world.time && s.destination) {
        return this.navigate(world, s.destination, s.destinationLabel ?? 'STAGING', 'RELOCATING · CLEARING THOROUGHFARE', '');
      }
      // B. am I in somebody's way?
      const approacher = this.findApproacher(world);
      if (approacher && world.time > this.stepAsideCooldownUntil) {
        if (this.idleBlockedSince === null) this.idleBlockedSince = world.time;
        // give the approaching robot a moment to solve it itself first
        if (world.time - this.idleBlockedSince > 1.1) {
          const r = this.stepAside(world, approacher);
          if (r) return r;
        }
      } else {
        this.idleBlockedSince = null;
      }
      // C. hold
      s.status = ctx.traffic.localDensity > 0.6 ? 'WAITING' : 'IDLE';
      s.navState = 'NO_PLAN';
      s.destination = null;
      s.destinationLabel = null;
      this.dropPlan('IDLE');
      return this.commit(world, 'IDLE', { type: 'WAIT', v: 0, w: 0 }, 'AWAITING TASK ALLOCATION', [
        { label: 'BIDS OPEN', value: `${world.tasks.openAnnouncements().length}` },
        { label: 'BATTERY', value: `${s.battery.toFixed(0)}%` },
      ]);
    }

    return this.commit(world, 'IDLE', { type: 'WAIT', v: 0, w: 0 }, 'NO ACTION', []);
  }

  // ─────────────────────────────────────────────────────────────────────────

  private executeTask(world: AgentWorld, task: Task): RobotDecision | null {
    const s = this.state;
    s.taskPriority = task.priority;

    // If I had to perform an evasive manoeuvre, finish it before resuming the
    // job — then my own planner takes over again from the new position.
    if (this.steppingAsideUntil > world.time && s.destination && this.resumeTaskAfterEvasion) {
      return this.navigate(world, s.destination, s.destinationLabel ?? 'STAGING', 'EVASIVE MANOEUVRE IN PROGRESS', task.id);
    }
    this.resumeTaskAfterEvasion = false;

    switch (task.phase) {
      case 'TO_PICK': {
        const target = { x: task.from.x, y: task.from.y };
        const d = dist(s.pose.x, s.pose.y, target.x, target.y);
        if (d < ARRIVE_EPS) {
          task.phase = 'PICKING';
          s.taskPhase = 'PICKING';
          s.status = 'PICKING';
          s.navState = 'ARRIVED';
          this.pickTimer = PICK_DWELL;
          this.dropPlan('ARRIVED AT PICK');
          return this.commit(world, 'PICK', { type: 'STOP', v: 0, w: 0 }, `AT PICK FACE · ${task.from.label}`, [
            { label: 'TASK', value: task.id },
            { label: 'TARGET', value: task.from.label },
          ]);
        }
        return this.navigate(world, target, task.from.label, `TO PICK · ${task.from.label}`, task.id);
      }

      case 'PICKING': {
        this.pickTimer -= world.dt;
        s.status = 'PICKING';
        if (this.pickTimer > 0) {
          return this.commit(world, 'PICK', { type: 'PICK', v: 0, w: 0 }, `MANIPULATOR CYCLE · ${this.pickTimer.toFixed(1)}s`, [
            { label: 'PACKAGE', value: task.packageId ?? '—' },
            { label: 'WEIGHT', value: `${task.weightKg.toFixed(1)} kg` },
          ]);
        }
        // acquire the payload
        const pkg = task.packageId ? world.warehouse.packageById(task.packageId) : undefined;
        if (pkg) {
          pkg.state = 'CARRIED';
          pkg.carrierId = s.id;
          pkg.x = null;
          pkg.y = null;
        }
        s.carryingPackageId = task.packageId ?? null;
        s.payloadKg = task.weightKg;
        task.phase = 'TO_DROP';
        s.taskPhase = 'TO_DROP';
        this.dropPlan('PICK COMPLETE');
        this.broadcast(world, { kind: 'STATUS', from: s.id, t: world.time, status: 'CARRYING', battery: s.battery, pose: { x: s.pose.x, y: s.pose.y }, theta: s.pose.theta });
        return this.commit(world, 'CONTINUE', { type: 'STOP', v: 0, w: 0 }, `PICKED ${task.packageId} · PLANNING DELIVERY`, [
          { label: 'PAYLOAD', value: `${task.weightKg.toFixed(1)} kg` },
          { label: 'DESTINATION', value: task.to.label },
        ]);
      }

      case 'TO_DROP': {
        const target = { x: task.to.x, y: task.to.y };
        const d = dist(s.pose.x, s.pose.y, target.x, target.y);
        if (d < ARRIVE_EPS) {
          task.phase = 'DROPPING';
          s.taskPhase = 'DROPPING';
          s.status = 'DROPPING';
          s.navState = 'ARRIVED';
          this.dropTimer = DROP_DWELL;
          this.dropPlan('ARRIVED AT DROP');
          return this.commit(world, 'DROP', { type: 'STOP', v: 0, w: 0 }, `AT STATION · ${task.to.label}`, [
            { label: 'TASK', value: task.id },
            { label: 'STATION', value: task.to.label },
          ]);
        }
        return this.navigate(world, target, task.to.label, `TO DROP · ${task.to.label}`, task.id);
      }

      case 'DROPPING': {
        this.dropTimer -= world.dt;
        s.status = 'DROPPING';
        if (this.dropTimer > 0) {
          return this.commit(world, 'DROP', { type: 'DROP', v: 0, w: 0 }, `TRANSFER CYCLE · ${this.dropTimer.toFixed(1)}s`, [
            { label: 'STATION', value: task.to.label },
          ]);
        }
        const pkg = task.packageId ? world.warehouse.packageById(task.packageId) : undefined;
        if (pkg) {
          pkg.state = 'DELIVERED';
          pkg.x = task.to.x;
          pkg.y = task.to.y;
          pkg.carrierId = undefined;
          pkg.taskId = undefined;
        }
        s.carryingPackageId = null;
        s.payloadKg = 0;
        s.completedTasks++;
        s.taskId = null;
        s.taskPhase = null;
        s.taskPriority = null;
        s.status = 'IDLE';
        s.navState = 'NO_PLAN';
        this.dropPlan('TASK COMPLETE');
        world.tasks.complete(task.id, world.time);
        this.broadcast(world, { kind: 'TASK_DONE', from: s.id, taskId: task.id, t: world.time });
        return this.commit(world, 'CONTINUE', { type: 'STOP', v: 0, w: 0 }, `${task.id} COMPLETED`, [
          { label: 'DELIVERED TO', value: task.to.label },
          { label: 'COMPLETED', value: `${s.completedTasks} TASKS` },
        ]);
      }
      default:
        return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NAVIGATION: plan → conflict resolution → action
  // ─────────────────────────────────────────────────────────────────────────

  private navigate(world: AgentWorld, target: Vec2, label: string, purpose: string, taskId: string): RobotDecision {
    const s = this.state;

    // Generic arrival — applies to staging / charger / any non-task waypoint.
    // Task waypoints are handled by executeTask before navigate() is reached.
    if (dist(s.pose.x, s.pose.y, target.x, target.y) < ARRIVE_EPS) {
      this.steppingAsideUntil = 0;
      this.dropPlan(`ARRIVED AT ${label}`);
      s.navState = 'ARRIVED';
      s.destination = null;
      s.destinationLabel = null;
      return this.commit(world, 'CONTINUE', { type: 'STOP', v: 0, w: 0 }, `ARRIVED · ${label}`, [
        { label: 'WAYPOINT', value: label },
      ]);
    }

    const key = `${target.x.toFixed(2)},${target.y.toFixed(2)}`;
    const targetChanged = key !== this.targetKey;
    if (targetChanged) {
      // NOTE: dropPlan() clears targetKey, so it must run BEFORE we latch the
      // new key — otherwise every tick looks like a target change and the agent
      // replans from scratch forever.
      this.dropPlan('TARGET CHANGED');
      this.targetKey = key;
    }
    s.destination = { ...target };
    s.destinationLabel = label;

    const ctx = this.context!;
    const planBlocked = ctx.obstacles.planBlocked;
    const noPlan = !s.plan || s.plan.status === 'ABORTED';

    // ── periodical re-evaluation: is my current plan still the best one? ────
    let shouldReplan = noPlan || planBlocked;
    if (!shouldReplan && world.time - this.lastReplanCheck > REPLAN_CHECK_INTERVAL * 1.8) {
      this.lastReplanCheck = world.time;
      const alt = this.planTo(world, target, taskId, 'PERIODIC RE-EVALUATION');
      if (alt) {
        const cur = s.plan!;
        // Switch only if meaningfully better — otherwise the agent thrashes
        // between near-identical routes and the replan counter is meaningless.
        if (alt.cost < cur.cost * 0.74) {
          this.adoptPlan(world, alt, 'CHEAPER ROUTE FOUND', taskId);
          shouldReplan = false;
        }
      }
    }

    if (shouldReplan) {
      const reason = noPlan ? 'NO ACTIVE PLAN' : ctx.obstacles.ahead
        ? `OBSTACLE ${ctx.obstacles.ahead.distance.toFixed(1)}m AHEAD`
        : 'ROUTE BELIEVED BLOCKED';
      const p = this.planTo(world, target, taskId, reason);
      if (!p) {
        s.status = 'BLOCKED';
        s.navState = 'PLAN_FAILED';
        s.replanCount++;
        return this.commit(world, 'REPLAN_FAILED', { type: 'HOLD_POSITION', v: 0, w: 0 }, `NO FEASIBLE ROUTE · ${reason}`, [
          { label: 'TARGET', value: label },
          { label: 'BLOCKED CELLS', value: `${ctx.obstacles.blockedCells}` },
        ]);
      }
      this.adoptPlan(world, p, reason, taskId);
      s.status = 'REROUTING';
      s.navState = 'PLANNING';
      return this.commit(world, 'REROUTE', { type: 'REROUTE', v: 0, w: 0 }, `REPLANNED · ${reason}`, [
        { label: 'NEW COST', value: p.cost.toFixed(2) },
        { label: 'REVISION', value: `r${p.revision}` },
        { label: 'LENGTH', value: `${p.length.toFixed(1)} m` },
      ]);
    }

    // ── MECHANICAL BLOCKAGE ─────────────────────────────────────────────────
    // Time-to-collision alone cannot see a deadlock: two robots standing nose
    // to nose have zero relative velocity, therefore infinite TTC, therefore
    // "no conflict" — yet neither can move. This layer detects the physical
    // fact of being blocked and resolves it, which is the case a real fleet
    // hits constantly in narrow aisles.
    // Progress tracking: a robot can be "moving" and still be going nowhere,
    // which is exactly what a steering limit cycle in a tight aisle looks like.
    const remainingNow = this.remainingDistance();
    if (this.lastRemaining === null || remainingNow < this.lastRemaining - 0.2) {
      this.lastRemaining = remainingNow;
      this.noProgressSince = world.time;
    }
    const stalled = world.time - this.noProgressSince > 2.4;

    const blocker = this.findBlocker();
    if (blocker && (s.speed < 0.12 || stalled)) {
      if (this.holdSince === null) this.holdSince = world.time;
      const held = world.time - this.holdSince;
      s.memory.yieldingTo = blocker.id;

      // 1. Try to route around. The blocker's cells are already hard-blocked in
      //    my costmap (see buildCostView), so any new plan must go elsewhere.
      //    Rate-limited: re-planning every tick would keep resetting the jam
      //    timer and the fleet would never escalate to a physical resolution.
      if (held > 0.7 && world.time - this.lastBypassAt > 3.0) {
        this.lastBypassAt = world.time;
        const alt = this.planTo(world, target, taskId, `BLOCKED BY ${blocker.id} · SEEKING BYPASS`);
        const curCost = s.plan?.cost ?? Infinity;
        if (alt && alt.cost < curCost * 2.2) {
          this.adoptPlan(world, alt, `BYPASSED ${blocker.id}`, taskId);
          s.memory.yieldingTo = null;
          s.status = 'REROUTING';
          s.navState = 'AVOIDING';
          return this.commit(world, 'REROUTE', { type: 'REROUTE', v: 0, w: 0 }, `BYPASSED ${blocker.id} · NEW ROUTE`, [
            { label: 'PEER', value: blocker.id },
            { label: 'GAP', value: `${blocker.distance.toFixed(2)} m` },
            { label: 'HELD FOR', value: `${held.toFixed(1)} s` },
          ]);
        }
      }

      // 2. No bypass exists: fall back on right-of-way. Whoever must give way
      //    waits; whoever has priority creeps forward to encourage movement.
      const peerState = world.robots.find((r) => r.id === blocker.id);
      const peerSnap: SelfSnapshot = {
        id: blocker.id,
        x: blocker.x, y: blocker.y, vx: blocker.vx, vy: blocker.vy,
        speed: Math.hypot(blocker.vx, blocker.vy),
        carrying: peerState?.carryingPackageId != null,
        taskPriority: peerState?.taskPriority ?? null,
        battery: peerState?.battery ?? 100,
        chargingIntent: peerState?.status === 'CHARGING',
        assertiveness: peerState?.memory.traits.assertiveness ?? 0.5,
      };
      blocker.yieldTo = rightOfWay(this.snapshot(), peerSnap) < 0;

      const patience = 2.0 + s.memory.traits.assertiveness * 2.6;
      if (held > patience) {
        // Jam timeout: someone has to move. The robot that must yield reverses
        // or detours; the other creeps. Deterministic, no supervisor.
        this.holdSince = null;
        s.memory.yieldingTo = null;
        if (blocker.yieldTo) {
          // I must give way, and waiting has not helped — back out of the
          // aisle so the other robot can pass. This is the physical resolution
          // a real AMR performs when negotiation alone cannot clear a corridor.
          this.reverseUntil = world.time + 1.9;
          this.lastBypassAt = world.time;
          s.status = 'MOVING';
          s.navState = 'AVOIDING';
          this.throttle = 1;
          return this.commit(world, 'YIELD', { type: 'MOVE_BACKWARD', v: 0.3, w: 0 }, `GIVING WAY · REVERSING TO CLEAR ${blocker.id}`, [
            { label: 'PEER', value: blocker.id },
            { label: 'HELD FOR', value: `${held.toFixed(1)} s` },
            { label: 'RIGHT OF WAY', value: blocker.id },
          ]);
        }
        this.throttle = 0.5;
        s.status = 'MOVING';
        s.navState = 'AVOIDING';
        return this.commit(world, 'CONTINUE', { type: 'MOVE_FORWARD', v: 0.28, w: 0 }, `JAM TIMEOUT ${held.toFixed(1)}s · CREEPING PAST ${blocker.id}`, [
          { label: 'PEER', value: blocker.id },
          { label: 'RIGHT OF WAY', value: blocker.yieldTo ? blocker.id : s.id },
        ]);
      }

      this.throttle = 0;
      s.status = 'WAITING';
      s.navState = 'YIELDING';
      return this.commit(world, 'YIELD', { type: 'WAIT', v: 0, w: 0 }, `BLOCKED BY ${blocker.id} · HOLDING ${held.toFixed(1)}s`, [
        { label: 'PEER', value: blocker.id },
        { label: 'GAP', value: `${blocker.distance.toFixed(2)} m` },
        { label: 'HELD FOR', value: `${held.toFixed(1)} s` },
        { label: 'RIGHT OF WAY', value: blocker.yieldTo ? blocker.id : s.id },
      ]);
    }

    // ── PREDICTIVE CONFLICT RESOLUTION (moving peers) ────────────────────────
    const conflicts = ctx.traffic.predictedConflicts;
    const snap = this.snapshot();
    for (const c of conflicts) {
      const peerDet = this.perception!.detectedRobots.find((r) => r.id === c.b);
      if (!peerDet) continue;
      // Peers publish their real negotiation state over comms; if we have it we
      // use it, otherwise we fall back on what we observed. Either way both
      // sides evaluate the same pure function, so they agree without a referee.
      const peerState = world.robots.find((r) => r.id === c.b);
      const peerSnap: SelfSnapshot = {
        id: c.b,
        x: peerDet.x, y: peerDet.y, vx: peerDet.vx, vy: peerDet.vy,
        speed: Math.hypot(peerDet.vx, peerDet.vy),
        carrying: peerState?.carryingPackageId != null,
        taskPriority: peerState?.taskPriority ?? null,
        battery: peerState?.battery ?? 100,
        chargingIntent: peerState?.status === 'CHARGING',
        assertiveness: peerState?.memory.traits.assertiveness ?? 0.5,
      };
      peerDet.yieldTo = rightOfWay(snap, peerSnap) < 0;
      if (c.severity === 'LOW') continue;

      if (peerDet.yieldTo) {
        // HOW I yield depends on my own personality — assertive agents slow,
        // cautious agents stop. This is why two robots in the same situation
        // visibly behave differently.
        const iAmAssertive = s.memory.traits.assertiveness > 0.55;
        s.memory.yieldingTo = c.b;
        if (this.holdSince === null) this.holdSince = world.time;
        const held = world.time - this.holdSince;

        const breaker = deadlockBreaker(s, held, this.rng);
        if (breaker !== 'KEEP_WAITING') {
          this.holdSince = null;
          s.memory.yieldingTo = null;
          if (breaker === 'REROUTE') {
            const alt = this.planTo(world, target, taskId, `YIELD TO ${c.b} · SEEKING ALTERNATE`);
            if (alt && (!s.plan || alt.cost < s.plan.cost * 1.45)) {
              this.adoptPlan(world, alt, `YIELD TO ${c.b}`, taskId);
              s.status = 'REROUTING';
              s.navState = 'AVOIDING';
              return this.commit(world, 'REROUTE', { type: 'REROUTE', v: 0, w: 0 }, `YIELD BY DETOUR · ${c.b}`, [
                { label: 'PEER', value: c.b },
                { label: 'TTC', value: `${c.ttc.toFixed(2)}s` },
                { label: 'CPA', value: `${c.cpa.toFixed(2)}m` },
              ]);
            }
          }
          this.throttle = 0.45;
          s.status = 'MOVING';
          s.navState = 'AVOIDING';
          return this.commit(world, 'CONTINUE', { type: 'MOVE_FORWARD', v: 0.2, w: 0 }, `DEADLOCK BROKEN · PROCEEDING CAUTIOUSLY PAST ${c.b}`, [
            { label: 'HELD FOR', value: `${held.toFixed(1)}s` },
            { label: 'PEER', value: c.b },
          ]);
        }

        if (!iAmAssertive) {
          this.throttle = 0;
          s.status = 'WAITING';
          s.navState = 'YIELDING';
          return this.commit(world, 'YIELD', { type: 'WAIT', v: 0, w: 0 }, `YIELDING TO ${c.b} · TTC ${c.ttc.toFixed(1)}s`, [
            { label: 'PEER', value: c.b },
            { label: 'TTC', value: `${c.ttc.toFixed(2)}s` },
            { label: 'CPA', value: `${c.cpa.toFixed(2)}m` },
            { label: 'RIGHT OF WAY', value: `${c.b}` },
          ]);
        }
        // assertive agents prefer to slow down rather than stop
        this.throttle = 0.3;
        s.status = 'MOVING';
        s.navState = 'AVOIDING';
        return this.commit(world, 'CONTINUE', { type: 'MOVE_FORWARD', v: 0.3, w: 0 }, `SLOWING FOR ${c.b}`, [
          { label: 'PEER', value: c.b },
          { label: 'TTC', value: `${c.ttc.toFixed(2)}s` },
        ]);
      }
      // I have right of way: proceed, but stay alert
      this.throttle = 0.85;
    }

    if (this.holdSince !== null && conflicts.length === 0) {
      this.holdSince = null;
      s.memory.yieldingTo = null;
    }
    if (conflicts.length === 0) this.throttle = ema(this.throttle, 1, 0.5);

    s.status = s.speed > 0.04 ? 'MOVING' : 'MOVING';
    s.navState = 'FOLLOWING';

    // stuck detection
    if (s.speed < 0.03 && this.throttle > 0.2) {
      s.memory.stuckTicks++;
    } else if (stalled && world.time - this.lastBypassAt > 2.5) {
      // Moving but not progressing — typically a steering limit cycle. Force a
      // fresh plan from the current pose so the agent breaks out of it.
      this.lastBypassAt = world.time;
      s.memory.stuckTicks = 99;
      if (s.memory.stuckTicks > 22) {
        s.memory.stuckTicks = 0;
        const alt = this.planTo(world, target, taskId, 'STUCK · RECOVERY REPLAN');
        if (alt) {
          this.adoptPlan(world, alt, 'STUCK RECOVERY', taskId);
          s.status = 'REROUTING';
          s.navState = 'PLANNING';
          s.replanCount++;
          return this.commit(world, 'REROUTE', { type: 'REROUTE', v: 0, w: 0 }, 'STUCK · RECOVERY REPLAN', [
            { label: 'TARGET', value: label },
          ]);
        }
      }
    } else {
      s.memory.stuckTicks = Math.max(0, s.memory.stuckTicks - 1);
    }

    return this.commit(world, 'MOVE', { type: 'FOLLOW_PATH', v: CRUISE, w: 0 }, purpose, [
      { label: 'REMAINING', value: `${(s.plan?.points.length ? this.remainingDistance() : 0).toFixed(1)} m` },
      { label: 'ETA', value: `${((s.plan?.points.length ? this.remainingDistance() : 0) / CRUISE).toFixed(1)} s` },
      { label: 'NEARBY', value: `${ctx.traffic.nearbyCount}` },
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────────

  private goCharge(world: AgentWorld, distance: number): RobotDecision {
    const s = this.state;
    const charger = world.warehouse.nearestCharger(s.pose.x, s.pose.y);
    const d = dist(s.pose.x, s.pose.y, charger.x, charger.y);
    if (d < 0.45) {
      if (charger.occupiedBy && charger.occupiedBy !== s.id) {
        // occupied — pick another, decided locally, no dispatcher
        const alt = world.warehouse.chargers.find((c) => !c.occupiedBy);
        if (alt) return this.navigate(world, { x: alt.x, y: alt.y }, alt.id, `CHARGER BUSY → ${alt.id}`, '');
      }
      charger.occupiedBy = s.id;
      this.chargingStationId = charger.id;
      s.status = 'CHARGING';
      s.navState = 'ARRIVED';
      this.dropPlan('CHARGING');
      return this.commit(world, 'CHARGE', { type: 'CHARGE', v: 0, w: 0 }, `DOCKED AT ${charger.id} · ${s.battery.toFixed(0)}%`, [
        { label: 'BATTERY', value: `${s.battery.toFixed(0)}%` },
        { label: 'CHARGER', value: charger.id },
      ]);
    }
    s.chargingIntentFlag = true;
    return this.navigate(world, { x: charger.x, y: charger.y }, charger.id, `NAVIGATING TO ${charger.id}`, '');
  }

  private releaseCharger(world: AgentWorld) {
    if (!this.chargingStationId) return;
    const c = world.warehouse.chargers.find((x) => x.id === this.chargingStationId);
    if (c && c.occupiedBy === this.state.id) c.occupiedBy = null;
    this.chargingStationId = null;
    this.state.chargingIntentFlag = false;
  }

  /**
   * A peer that is physically preventing me from making progress: it is within
   * blocking range AND it sits in the half-plane I am trying to move into.
   * Distance-only tests are not enough — a robot behind me must be ignored.
   */
  private findBlocker(): DetectedRobot | null {
    const s = this.state;
    const fx = Math.cos(s.pose.theta);
    const fy = Math.sin(s.pose.theta);
    let best: DetectedRobot | null = null;
    for (const p of this.perception?.detectedRobots ?? []) {
      if (p.distance > 2.8) continue;
      const ahead = (p.x - s.pose.x) * fx + (p.y - s.pose.y) * fy;
      const lateral = Math.abs((p.x - s.pose.x) * -fy + (p.y - s.pose.y) * fx);
      // in front of me and roughly in my lane
      if (ahead < -0.35 || lateral > 1.25) continue;
      if (!best || p.distance < best.distance) best = p;
    }
    return best;
  }

  /**
   * COOPERATION: an idle agent that notices a working robot trying to get past
   * moves aside. Nobody tells it to — it infers intent purely from its own
   * perception of the peer's motion. This is decentralised coordination made
   * visible, and it is the mechanism that clears corridor jams.
   */
  private findApproacher(world: AgentWorld): DetectedRobot | null {
    for (const p of this.perception?.detectedRobots ?? []) {
      if (p.distance > 3.2) continue;
      const speed = Math.hypot(p.vx, p.vy);
      // Only make way for a peer that is genuinely trying to go somewhere.
      // If everybody is idle, nobody needs to move — otherwise two idle robots
      // politely dodge each other forever.
      if (speed > 0.08) return p;
      const peer = world.robots.find((r) => r.id === p.id);
      if (peer && (peer.taskId || peer.destination) && p.distance < 2.2) return p;
    }
    return null;
  }

  private stepAside(world: AgentWorld, approacher: DetectedRobot): RobotDecision | null {
    const s = this.state;
    const dx = s.pose.x - approacher.x;
    const dy = s.pose.y - approacher.y;
    const n = Math.hypot(dx, dy) || 1;
    // step perpendicular to the approach vector, into whichever side is free
    const cands = [
      { x: s.pose.x + (-dy / n) * 2.0, y: s.pose.y + (dx / n) * 2.0 },
      { x: s.pose.x + (dy / n) * 2.0, y: s.pose.y + (-dx / n) * 2.0 },
      { x: s.pose.x + (dx / n) * 2.4, y: s.pose.y + (dy / n) * 2.4 },
    ];
    for (const c of cands) {
      const pt = { x: clamp(c.x, 1.0, WORLD_W - 1.0), y: clamp(c.y, 1.0, WORLD_H - 1.0) };
      if (!world.warehouse.isFree(pt.x, pt.y)) continue;
      const p = this.planTo(world, pt, '', 'STEPPING ASIDE');
      if (!p) continue;
      this.adoptPlan(world, p, `YIELD TO ${approacher.id}`, '');
      s.status = 'MOVING';
      s.navState = 'AVOIDING';
      s.destination = pt;
      s.destinationLabel = 'STAGING';
      this.stepAsideCooldownUntil = world.time + 5.5;
      this.steppingAsideUntil = world.time + 14;
      this.idleBlockedSince = null;
      return this.commit(world, 'YIELD', { type: 'MOVE_FORWARD', v: 0.5, w: 0 }, `CLEARING PATH FOR ${approacher.id}`, [
        { label: 'PEER', value: approacher.id },
        { label: 'DISTANCE', value: `${approacher.distance.toFixed(2)} m` },
      ]);
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PLANNING
  // ─────────────────────────────────────────────────────────────────────────

  private planTo(world: AgentWorld, goal: Vec2, taskId: string, reason: string): Path | null {
    const s = this.state;
    const view = this.buildCostView(world, goal);
    const res = planAStar({
      grid: world.grid,
      start: { x: s.pose.x, y: s.pose.y },
      goal,
      view,
      speed: CRUISE,
    });
    if (!res.found || res.points.length === 0) {
      s.plan = null;
      return null;
    }
    this.planCounter++;
    const prev = s.plan;
    return {
      id: shortId('PATH', this.planCounter),
      robotId: s.id,
      points: res.points,
      status: 'PLANNED',
      length: res.length,
      cost: res.cost,
      plannedAt: world.time,
      generation: (prev?.generation ?? 0) + 1,
      revision: (prev?.revision ?? 0) + 1,
      cursor: 0,
      taskId,
      replanReason: reason,
    };
  }

  /**
   * The agent's OWN costmap. Built from its own sensors, its own memory and
   * the peer intents it happened to receive. Another agent one metre away
   * builds a different one.
   */
  private buildCostView(world: AgentWorld, goal: Vec2): CostView {
    const s = this.state;
    const cell = world.grid.spec.cell;
    const blocked = new Set<string>();
    const soft = new Map<string, number>();

    // ── keep-right convention ──────────────────────────────────────────────
    // Two agents travelling the same aisle in opposite directions would
    // otherwise both plan down the exact centreline and meet head-on. Biasing
    // each plan to the right of its own travel axis gives every corridor a
    // natural two-way flow, exactly like a real warehouse traffic rule — and it
    // emerges from each agent's own planner, not from a traffic controller.
    const ax = goal.x - s.pose.x;
    const ay = goal.y - s.pose.y;
    const an = Math.hypot(ax, ay) || 1;
    const lnx = -(ay / an); // left-hand normal of the travel axis
    const lny = ax / an;

    // personally observed obstacles, inflated by my own footprint
    for (const o of this.perception?.detectedObstacles ?? []) {
      const c = world.grid.worldToCell(o.x, o.y);
      const rad = Math.ceil((o.r + s.capabilities.footprint * 0.65) / cell);
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          const k = `${c.ix + dx},${c.iy + dy}`;
          blocked.add(k);
        }
    }
    // remembered hazards
    const now = world.time;
    for (const [k, t] of s.memory.knownBlocked) {
      if (now - t > 40) continue;
      if (now - t > 22) {
        soft.set(k, (soft.get(k) ?? 0) + 1.2); // old belief → soft penalty
      } else {
        blocked.add(k);
      }
    }
    // Peers. A STOPPED peer is physically indistinguishable from a static
    // obstacle to my planner — treat its cells as blocked so I route around it.
    // A MOVING peer only earns a soft penalty (it will not be there by the time
    // I arrive). This distinction is what lets the fleet escape a jam.
    for (const p of this.perception?.detectedRobots ?? []) {
      if (p.distance > 2.6) continue;
      const c = world.grid.worldToCell(p.x, p.y);
      const stationary = Math.hypot(p.vx, p.vy) < 0.08;
      const rad = stationary ? Math.ceil((0.72 * 1.15) / cell) : 0;
      if (stationary) {
        for (let dy = -rad; dy <= rad; dy++)
          for (let dx = -rad; dx <= rad; dx++) blocked.add(`${c.ix + dx},${c.iy + dy}`);
      } else {
        soft.set(`${c.ix},${c.iy}`, (soft.get(`${c.ix},${c.iy}`) ?? 0) + 6);
      }
    }

    const intents = (this.perception?.peerIntents ?? []).filter((i) => !i.stale);

    return {
      blocked: (ix, iy) => blocked.has(`${ix},${iy}`),
      extra: (ix, iy) => {
        let c = soft.get(`${ix},${iy}`) ?? 0;
        // this agent's personal aversion to crowded aisles
        c += (this.perception?.localDensity ?? 0) * s.memory.traits.congestionAversion * 0.8;
        const p = world.grid.cellToWorld(ix, iy);
        const off = (p.x - s.pose.x) * lnx + (p.y - s.pose.y) * lny;
        if (off > 0) c += off * 0.32; // right-hand side is cheaper
        return c;
      },
      reservation: (ix, iy, eta) => {
        const p = world.grid.cellToWorld(ix, iy);
        let c = 0;
        for (const it of intents) {
          for (const wp of it.waypoints) {
            if (Math.abs(wp.t - eta) < 1.4 && dist(p.x, p.y, wp.x, wp.y) < 0.85) c += 2.4;
          }
        }
        return c;
      },
    };
  }

  private adoptPlan(world: AgentWorld, p: Path, reason: string, taskId: string) {
    const s = this.state;
    if (s.plan) {
      s.plan.status = reason.includes('BLOCK') || reason.includes('OBSTACLE') || reason.includes('YIELD') || reason.includes('STUCK') ? 'BLOCKED' : 'COMPLETED';
      s.planHistory.unshift(s.plan);
      if (s.planHistory.length > 3) s.planHistory.pop();
    }
    p.status = 'ACTIVE';
    p.taskId = taskId;
    p.replanReason = reason;
    s.plan = p;
    this.lastRemaining = null;
    this.noProgressSince = world.time;
    s.replanCount++;
    s.memory.lastReplanAt = world.time;
    s.navState = 'FOLLOWING';
  }

  private dropPlan(reason: string) {
    const s = this.state;
    if (s.plan) {
      s.plan.status = 'COMPLETED';
      s.planHistory.unshift(s.plan);
      if (s.planHistory.length > 3) s.planHistory.pop();
      s.plan = null;
    }
    this.targetKey = '';
    this.throttle = 1;
    this.holdSince = null;
    void reason;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. EXECUTE
  // ─────────────────────────────────────────────────────────────────────────

  act(world: AgentWorld) {
    const s = this.state;
    const decision = s.lastDecision;

    // motion from the plan (or zero if the decision says stop)
    let cmd: MotionCommand = { v: 0, w: 0, arrived: false, cursor: 0, remaining: 0, alpha: 0, why: 'IDLE' };
    const wantsMotion =
      decision?.kind === 'MOVE' || decision?.kind === 'CONTINUE' || decision?.kind === 'REROUTE';

    if (wantsMotion && s.plan) {
      cmd = computeMotion(s, {
        dt: world.dt,
        safetyFactor: 1,
        throttle: this.throttle,
        cruise: CRUISE,
        avoid: (this.perception?.detectedRobots ?? []).map((r) => ({ x: r.x, y: r.y, vx: r.vx, vy: r.vy })),
      });
    }

    // Reversing to clear a corridor overrides forward path following.
    if (this.reverseUntil > world.time) {
      cmd = { ...cmd, v: -0.34, w: 0, why: 'REVERSING TO CLEAR' };
      s.navState = 'AVOIDING';
    }

    // reactive safety brake — pure geometry, overrides everything
    const brake = safetyBrake(
      s,
      this.perception?.detectedRobots ?? [],
      (this.perception?.detectedObstacles ?? []).map((o) => ({ x: o.x, y: o.y, r: o.r })),
    );
    if (brake.hardStop) cmd = { ...cmd, v: 0, why: `BRAKE:${brake.reason}` };
    else cmd = { ...cmd, v: cmd.v * brake.factor };

    // throttle limits how fast we can spin up, giving AMR-like dynamics
    this.cmd = cmd;

    const backendWorld: BackendWorldView = {
      obstacles: (this.perception?.detectedObstacles ?? []).map((o) => ({ x: o.x, y: o.y, r: o.r })),
      peers: (this.perception?.detectedRobots ?? []).map((r) => ({ id: r.id, x: r.x, y: r.y, vx: r.vx, vy: r.vy })),
      restricted: world.warehouse.zones.filter((z) => z.kind === 'RESTRICTED').map((z) => ({ x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1 })),
      speedCap: world.speedCap,
      isDrivable: (x, y) => {
        const c = world.grid.worldToCell(x, y);
        if (!world.grid.inBounds(c.ix, c.iy)) return false;
        return world.grid.clearance[world.grid.idx(c.ix, c.iy)] >= 1;
      },
    };

    this.backend.apply(cmd, s, world.dt, backendWorld, world.time);
    this.backend.sync(s, world.dt, world.time);
    if (this.backend.kind === 'SIMULATION') this.backend.drainBattery(s, world.dt);

    // utilisation (fraction of time doing useful work)
    const busy = s.taskId !== null || s.status === 'CHARGING' ? 1 : s.speed > 0.1 ? 0.5 : 0;
    s.utilisation = ema(s.utilisation, busy, 0.02);

    // trail
    if (world.time - this.lastTrailAt > TRAIL_INTERVAL) {
      this.lastTrailAt = world.time;
      s.trail.push({ x: s.pose.x, y: s.pose.y, t: world.time });
      if (s.trail.length > MAX_TRAIL) s.trail.shift();
    }

    // publish my intent so peers can plan around me (decentralised)
    if (world.time - this.lastIntentAt > INTENT_INTERVAL && s.plan) {
      this.lastIntentAt = world.time;
      const wps: { x: number; y: number; t: number }[] = [];
      const start = Math.min(s.plan.cursor, s.plan.points.length - 1);
      for (let i = start; i < Math.min(start + 8, s.plan.points.length); i++) {
        const p = s.plan.points[i];
        const d = dist(s.pose.x, s.pose.y, p.x, p.y);
        wps.push({ x: p.x, y: p.y, t: d / CRUISE });
      }
      this.broadcast(world, {
        kind: 'INTENT',
        from: s.id,
        t: world.time,
        waypoints: wps,
        priority: s.taskPriority === 'CRITICAL' ? 4 : s.taskPriority === 'HIGH' ? 3 : s.taskPriority ? 2 : 1,
        speed: s.speed,
      });
    }

    // congestion footprint on the shared grid (an environment-level effect)
    const c = world.grid.worldToCell(s.pose.x, s.pose.y);
    world.grid.addCongestion(c.ix, c.iy, 0.06);

    if (s.status !== this.lastStatus) {
      this.lastStatus = s.status;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Comms
  // ─────────────────────────────────────────────────────────────────────────

  private broadcast(world: AgentWorld, msg: Message) {
    world.bus.broadcast(msg, world.time);
  }

  private processInbox(world: AgentWorld) {
    const s = this.state;
    const msgs = world.bus.inbox(s.id);
    if (!msgs.length) return;

    for (const m of msgs) {
      switch (m.kind) {
        case 'TASK_ANNOUNCE': {
          if (this.lastAnnounceSeen.has(`${m.taskId}:${Math.floor(m.t * 4)}`)) break;
          this.lastAnnounceSeen.add(`${m.taskId}:${Math.floor(m.t * 4)}`);
          if (s.taskId || s.status === 'OFFLINE') break;
          const ann: AnnouncePayload = {
            taskId: m.taskId,
            priority: m.priority,
            from: m.from_,
            to: m.to_,
            requiresLidar: m.requiresLidar,
            weightKg: m.weightKg,
          };
          const dToPick = dist(s.pose.x, s.pose.y, ann.from.x, ann.from.y);
          const dPickToDrop = dist(ann.from.x, ann.from.y, ann.to.x, ann.to.y);
          const { bid, reason } = computeBid(s, this.context!, ann, dToPick, dPickToDrop, CRUISE);
          world.tasks.submitEvaluation(s.id, m.taskId, bid, reason, world.time);
          if (bid) {
            this.broadcast(world, { kind: 'TASK_BID', from: s.id, taskId: m.taskId, t: world.time, bid });
            this.pushDecision({
              robotId: s.id,
              at: world.time,
              kind: 'BID',
              action: { type: 'BID', v: 0, w: 0 },
              reason: `BID ${bid.cost.toFixed(1)} ON ${m.taskId}`,
              factors: [
                { label: 'DISTANCE', value: `${bid.distance} m`, weight: bid.distance },
                { label: 'BATTERY', value: `${bid.battery}%`, weight: bid.battery },
                { label: 'WORKLOAD', value: `${bid.workload}`, weight: bid.workload },
                { label: 'CONGESTION', value: `${bid.congestion}`, weight: bid.congestion },
                { label: 'ETA', value: `${bid.eta} s`, weight: bid.eta },
              ],
              confidence: 1 - Math.min(1, bid.cost / 120),
            });
          } else {
            this.pushDecision({
              robotId: s.id,
              at: world.time,
              kind: 'IDLE',
              action: { type: 'WAIT', v: 0, w: 0 },
              reason: `DECLINED ${m.taskId} · ${reason}`,
              factors: [{ label: 'REASON', value: reason ?? 'INELIGIBLE' }],
              confidence: 1,
            });
          }
          break;
        }
        case 'HAZARD': {
          const c = world.grid.worldToCell(m.x, m.y);
          const r = Math.ceil((m.r + 0.5) / world.grid.spec.cell);
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) s.memory.knownBlocked.set(`${c.ix + dx},${c.iy + dy}`, world.time);
          if (s.plan) s.plan.status = 'BLOCKED';
          break;
        }
        case 'ESTOP': {
          if (m.robotId === s.id || m.robotId === '*') s.estop = true;
          break;
        }
        default:
          break;
      }
    }
    world.bus.clearInbox(s.id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private snapshot(): SelfSnapshot {
    const s = this.state;
    return {
      id: s.id,
      x: s.pose.x,
      y: s.pose.y,
      vx: s.vx,
      vy: s.vy,
      speed: s.speed,
      carrying: s.carryingPackageId !== null,
      taskPriority: s.taskPriority,
      battery: s.battery,
      chargingIntent: s.status === 'CHARGING' || !!s.chargingIntentFlag,
      assertiveness: s.memory.traits.assertiveness,
    };
  }

  private remainingDistance() {
    const s = this.state;
    if (!s.plan) return 0;
    const p = s.plan.points;
    let d = dist(s.pose.x, s.pose.y, p[Math.min(s.plan.cursor, p.length - 1)].x, p[Math.min(s.plan.cursor, p.length - 1)].y);
    for (let i = s.plan.cursor; i < p.length - 1; i++) d += dist(p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
    return d;
  }

  private commit(world: AgentWorld, kind: DecisionKind, action: RobotAction, reason: string, factors: RobotDecision['factors']): RobotDecision {
    const d: RobotDecision = {
      robotId: this.state.id,
      at: world.time,
      kind,
      action,
      reason,
      factors,
      confidence: kind === 'MOVE' ? 0.9 : 0.75,
    };
    this.state.lastDecision = d;
    this.state.action = action.type;
    this.pushDecision(d);
    return d;
  }

  private pushDecision(d: RobotDecision) {
    const h = this.state.decisionHistory;
    if (h.length && h[h.length - 1].kind === d.kind && h[h.length - 1].reason === d.reason) {
      h[h.length - 1] = d;
      return;
    }
    h.push(d);
    if (h.length > 40) h.shift();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // External control
  // ─────────────────────────────────────────────────────────────────────────

  assignTask(world: AgentWorld, taskId: string) {
    const s = this.state;
    s.taskId = taskId;
    s.taskPhase = 'TO_PICK';
    s.status = 'MOVING';
    this.dropPlan('TASK ASSIGNED');
    world.tasks.begin(taskId, world.time);
  }

  detachTask(world: AgentWorld, reason: string) {
    const s = this.state;
    if (!s.taskId) return;
    const id = s.taskId;
    s.taskId = null;
    s.taskPhase = null;
    s.taskPriority = null;
    s.carryingPackageId = null;
    s.payloadKg = 0;
    this.dropPlan(reason);
    world.tasks.requeue(id, reason);
  }

  fail(reason: string) {
    const s = this.state;
    s.status = 'OFFLINE';
    s.navState = 'NO_PLAN';
    s.connected = false;
    s.speed = 0;
    s.vx = 0;
    s.vy = 0;
    s.lastDecision = {
      robotId: s.id,
      at: 0,
      kind: 'HOLD',
      action: { type: 'STOP', v: 0, w: 0 },
      reason,
      factors: [],
      confidence: 1,
    };
    s.action = 'STOP';
  }

  recover(world: AgentWorld) {
    const s = this.state;
    s.status = 'IDLE';
    s.connected = true;
    s.estop = false;
    s.navState = 'NO_PLAN';
    this.dropPlan('RECOVERED');
    this.offlineAt = null;
    this.broadcast(world, { kind: 'STATUS', from: s.id, t: world.time, status: 'IDLE', battery: s.battery, pose: { x: s.pose.x, y: s.pose.y }, theta: s.pose.theta });
  }

  /** Swap the execution body without touching identity, context or task. */
  setBackend(b: RobotExecutionBackend) {
    const prev = this.backend;
    this.backend = b;
    if (b instanceof PhysicalBackend) b.adoptPhysicalPose(this.state);
    if (prev instanceof PhysicalBackend) {
      this.state.twin = makeTwin(this.state.id);
      this.state.executionMode = 'SIMULATION';
      this.state.hardwareId = null;
      this.state.real = false;
    }
    if (b instanceof PhysicalBackend) {
      this.state.executionMode = 'PHYSICAL';
      this.state.hardwareId = b.hardwareId;
      this.state.real = true;
      this.state.twin.hardwareId = b.hardwareId;
      this.state.twin.hardwareClass = b.label.includes('MOCK') ? 'MOCK' : 'PHYSICAL';
    } else {
      this.state.executionMode = 'SIMULATION';
      this.state.hardwareId = null;
      this.state.real = false;
      this.state.twin = makeTwin(this.state.id);
    }
    this.dropPlan('BACKEND SWAPPED');
  }

  get lastCommand() {
    return this.cmd;
  }

  /** Perception of obstacles detected by THIS agent, for the UI overlay. */
  get visibleObstacles(): Obstacle[] {
    return (this.perception?.detectedObstacles ?? []).map((o) => ({
      id: o.id, x: o.x, y: o.y, r: o.r, kind: 'TEMPORARY' as const, createdAt: 0, ttl: -1,
    }));
  }

  get detectedPeers(): DetectedRobot[] {
    return this.perception?.detectedRobots ?? [];
  }

  get heading() {
    return wrapAngle(this.state.pose.theta);
  }

  trailPoints(): PathPoint[] {
    return this.state.trail;
  }
}
