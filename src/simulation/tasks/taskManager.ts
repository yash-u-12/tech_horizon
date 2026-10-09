/**
 * TASK LIFECYCLE + SHARED TASK BOARD
 *
 * The board is a *ledger*, not a planner. It records what agents declare and
 * applies `selectWinner` — the exact same deterministic function every agent
 * runs locally over the bids it received. Because the rule is public and
 * symmetric, each robot can independently verify that the assignment is correct
 * without asking anyone. No optimiser, no dispatcher, no central brain.
 */

import type { Package, Task, TaskBid, TaskPriority, TaskSource, TaskType, Vec2 } from '../types';
import type { Warehouse } from '../environment/warehouse';
import { dist } from '../core/math';
import { mulberry32, type Rng } from '../core/rng';
import { selectWinner } from './allocation';

export const BID_WINDOW = 0.8; // seconds the board collects bids
export const CLAIM_WINDOW = 0.35;

export interface Station {
  id: string;
  name: string;
  kind: 'PACKING' | 'SORTING' | 'OUTBOUND' | 'INBOUND';
  x: number;
  y: number;
}

export const STATIONS: Station[] = [
  { id: 'PACKING-01', name: 'PACKING-01', kind: 'PACKING', x: 38.4, y: 4.0 },
  { id: 'PACKING-02', name: 'PACKING-02', kind: 'PACKING', x: 38.4, y: 7.6 },
  { id: 'PACKING-03', name: 'PACKING-03', kind: 'PACKING', x: 41.6, y: 4.0 },
  { id: 'PACKING-04', name: 'PACKING-04', kind: 'PACKING', x: 41.6, y: 7.6 },
  { id: 'SORTING-01', name: 'SORTING-01', kind: 'SORTING', x: 2.6, y: 4.0 },
  { id: 'SORTING-02', name: 'SORTING-02', kind: 'SORTING', x: 2.6, y: 7.6 },
  { id: 'OUTBOUND-01', name: 'OUTBOUND-01', kind: 'OUTBOUND', x: 38.4, y: 24.5 },
  { id: 'OUTBOUND-02', name: 'OUTBOUND-02', kind: 'OUTBOUND', x: 38.4, y: 28.5 },
  { id: 'INBOUND-01', name: 'INBOUND-01', kind: 'INBOUND', x: 2.6, y: 24.5 },
  { id: 'INBOUND-02', name: 'INBOUND-02', kind: 'INBOUND', x: 2.6, y: 28.5 },
];

export interface Evaluation {
  robotId: string;
  taskId: string;
  bid: TaskBid | null;
  reason?: string;
  at: number;
}

export interface TaskManagerConfig {
  seed: number;
}

export class TaskManager {
  tasks: Task[] = [];
  /** candidate evaluations for the currently open announcement windows */
  evaluations: Evaluation[] = [];
  private counter = 0;
  private rnd: Rng;
  cfg: TaskManagerConfig;

  private completedTimes: number[] = [];
  private createdTimes: number[] = [];

  constructor(cfg: TaskManagerConfig) {
    this.cfg = cfg;
    this.rnd = mulberry32(cfg.seed ^ 0x9e3779b9);
  }

  /** Create exactly one generated order through the same authoritative ledger. */
  createGenerated(now: number, warehouse: Warehouse): Task | null {
    const task = this.generateTask(now, warehouse);
    if (!task) return null;
    this.tasks.push(task);
    this.createdTimes.push(now);
    return task;
  }

  prioritizeOpenTasks(now: number, manualTaskId: string) {
    for (const task of this.tasks) {
      if (task.id === manualTaskId || (task.state !== 'ANNOUNCED' && task.state !== 'QUEUED')) continue;
      task.state = 'ANNOUNCED';
      task.announcedAt = now;
      task.bids = [];
      task.allocationReason = 'Reconsidered alongside a new Critical manual order.';
      task.trace.push({ at: now, event: 'RECONSIDERED', detail: task.allocationReason });
      this.evaluations = this.evaluations.filter((e) => e.taskId !== task.id);
      this.pendingAnnouncements.push(task);
    }
  }

  // ── order generation (the "WMS" — a dumb order source) ────────────────────

  private generateTask(now: number, warehouse: Warehouse): Task | null {
    const pkg = warehouse.pickRandomAvailablePackage(this.rnd);
    if (!pkg) return null;
    const rack = warehouse.rackById(pkg.rackId);
    const face = rack?.pickFace ?? { x: pkg.x ?? 0, y: pkg.y ?? 0 };

    const roll = this.rnd();
    const type: TaskType = roll < 0.72 ? 'PICK_DELIVER' : roll < 0.86 ? 'RETRIEVE' : 'REPLENISH';
    const stationPool =
      type === 'REPLENISH'
        ? STATIONS.filter((s) => s.kind === 'INBOUND')
        : type === 'RETRIEVE'
          ? STATIONS.filter((s) => s.kind === 'OUTBOUND')
          : STATIONS.filter((s) => s.kind === 'PACKING' || s.kind === 'SORTING');
    const station = stationPool[Math.floor(this.rnd() * stationPool.length)];

    const pRoll = this.rnd();
    const priority: TaskPriority = pRoll < 0.25 ? 'HIGH' : pRoll < 0.82 ? 'NORMAL' : 'LOW';

    this.counter++;
    const id = `TASK-${this.counter.toString().padStart(3, '0')}`;
    pkg.taskId = id;
    pkg.state = 'RESERVED';

    const task: Task = {
      id,
      type,
      source: 'GENERATED',
      priority,
      state: 'ANNOUNCED',
      allocationReason: 'Awaiting allocation evaluation.',
      from: { x: face.x, y: face.y, label: `${pkg.rackId} · ${pkg.id}`, rackId: pkg.rackId },
      to: { x: station.x, y: station.y, label: station.name },
      packageId: pkg.id,
      assignedTo: null,
      previousAssignees: [],
      createdAt: now,
      announcedAt: now,
      bids: [],
      trace: [{ at: now, event: 'CREATED', detail: 'Generated task added to the allocation queue.' }],
      phase: 'TO_PICK',
      reassignCount: 0,
      requiresLidar: this.rnd() < 0.8,
      weightKg: pkg.weightKg,
      slaSeconds: 45 + (priority === 'HIGH' ? 30 : 60),
    };
    task.trace.push({ at: now, event: 'ANNOUNCED', detail: 'Task entered the shared allocation queue.' });
    return task;
  }

  /** Deterministic on-demand task (used by the demo controls). */
  createExplicit(now: number, from: Vec2, fromLabel: string, to: Vec2, toLabel: string, priority: TaskPriority, source: TaskSource = 'MANUAL'): Task {
    this.counter++;
    const id = `TASK-${this.counter.toString().padStart(3, '0')}`;
    const task: Task = {
      id,
      type: 'PICK_DELIVER',
      source,
      priority,
      state: 'ANNOUNCED',
      allocationReason: 'Awaiting allocation evaluation.',
      from: { x: from.x, y: from.y, label: fromLabel },
      to: { x: to.x, y: to.y, label: toLabel },
      assignedTo: null,
      previousAssignees: [],
      createdAt: now,
      announcedAt: now,
      bids: [],
      trace: [{
        at: now,
        event: 'CREATED',
        detail: `${source === 'MANUAL' ? 'Manual Order' : source === 'SCENARIO' ? 'Scenario' : 'Generated'} created at ${now.toFixed(1)}s with ${priority} priority.`,
      }],
      phase: 'TO_PICK',
      reassignCount: 0,
      requiresLidar: true,
      weightKg: 2.5,
      slaSeconds: 60,
    };
    task.trace.push({ at: now, event: 'ANNOUNCED', detail: 'Task entered the shared allocation queue.' });
    this.tasks.push(task);
    return task;
  }

  // ── evaluation & assignment ───────────────────────────────────────────────

  submitEvaluation(ev: Evaluation) {
    this.evaluations.push(ev);
    const task = this.byId(ev.taskId);
    if (!task) return;
    task.trace.push({
      at: ev.at,
      event: ev.bid?.accepted ? 'CANDIDATE_ACCEPTED' : 'CANDIDATE_REJECTED',
      robotId: ev.robotId,
      detail: ev.bid?.reasoning ?? ev.reason ?? 'No eligible bid.',
      cost: ev.bid?.cost,
      distance: ev.bid?.distance,
      eta: ev.bid?.eta,
    });
  }

  /** Tasks the board wants (re)announced on the comms bus; engine drains it. */
  takeAnnouncements(): Task[] {
    const out = this.pendingAnnouncements;
    this.pendingAnnouncements = [];
    return out;
  }

  private pendingAnnouncements: Task[] = [];

  /**
   * Runs the public, deterministic winner rule over declared bids, and re-opens
   * auctions for jobs nobody could take at the time.  Without the re-announce
   * path a job that arrives when every robot is busy would be stranded forever.
   */
  resolveAnnouncements(now: number): { task: Task; winner: string; bids: TaskBid[] }[] {
    const out: { task: Task; winner: string; bids: TaskBid[] }[] = [];
    const due = this.tasks.filter((task) => task.state === 'ANNOUNCED' && now - task.announcedAt >= BID_WINDOW)
      .sort((a, b) => {
        const rank: Record<TaskPriority, number> = { CRITICAL: 4, HIGH: 3, NORMAL: 2, LOW: 1 };
        return rank[b.priority] - rank[a.priority] || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
      });
    for (const task of this.tasks) {
      if (task.state !== 'QUEUED' || now - task.announcedAt < BID_WINDOW + 1.4) continue;
      task.state = 'ANNOUNCED';
      task.announcedAt = now;
      task.bids = [];
      task.allocationReason = 'Awaiting fresh allocation evaluations.';
      task.trace.push({ at: now, event: 'REANNOUNCED', detail: 'Queued task reopened for a fresh allocation round.' });
      this.evaluations = this.evaluations.filter((e) => e.taskId !== task.id);
      this.pendingAnnouncements.push(task);
    }
    const claimedRobots = new Set<string>();
    for (const task of due) {

      const evs = this.evaluations.filter((e) => e.taskId === task.id);
      task.bids = evs.map((e) => e.bid ?? {
        robotId: e.robotId,
        cost: Infinity,
        distance: 0,
        battery: 0,
        workload: 0,
        congestion: 0,
        eta: 0,
        accepted: false,
        rejectedReason: e.reason ?? 'INELIGIBLE',
        at: e.at,
        breakdown: {
          distance: 0,
          battery: 0,
          workload: 0,
          congestion: 0,
          eta: 0,
          traitScale: 0,
          eagerness: 0,
          congestionAversion: 0,
        },
        reasoning: e.reason ?? 'INELIGIBLE',
      });

      const candidates = task.bids.filter((b) => b.accepted && Number.isFinite(b.cost) && !claimedRobots.has(b.robotId));
      const winner = selectWinner(candidates);
      if (winner) {
        // Reserve within this synchronous award batch. Agents evaluated all
        // simultaneously open auctions while idle, so a robot may appear as
        // the best bidder on several tasks in the same tick.
        claimedRobots.add(winner.robotId);
        task.state = 'ASSIGNED';
        task.assignedTo = winner.robotId;
        task.assignedAt = now;
        task.allocationReason = undefined;
        task.trace.push({
          at: now,
          event: 'ASSIGNED',
          robotId: winner.robotId,
          detail: `${winner.robotId} selected from eligible candidates at cost ${winner.cost.toFixed(2)}.`,
          cost: winner.cost,
          distance: winner.distance,
          eta: winner.eta,
        });
        out.push({ task, winner: winner.robotId, bids: task.bids });
      } else {
        // nobody was eligible at that moment — hold the job and re-open the
        // auction shortly. It keeps its original createdAt for SLA accounting.
        task.state = 'QUEUED';
        task.announcedAt = now;
        const reasons = [...new Set(evs.map((e) => e.reason ?? (e.bid?.accepted ? 'No assignment slot remained in this award cycle.' : 'No eligible bid.')))];
        task.allocationReason = reasons.length
          ? reasons.join('; ')
          : 'Awaiting allocation evaluations.';
        task.trace.push({ at: now, event: 'WAITING', detail: task.allocationReason });
      }
      this.evaluations = this.evaluations.filter((e) => e.taskId !== task.id);
    }
    return out;
  }

  reQueue(taskId: string, reason: string, now?: number) {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.assignedTo) t.previousAssignees.push(t.assignedTo);
    t.assignedTo = null;
    t.state = 'REASSIGNING';
    t.reassignCount++;
    t.failureReason = reason;
    t.allocationReason = reason;
    t.trace.push({ at: now ?? t.assignedAt ?? t.createdAt, event: 'REQUEUED', detail: reason });
    t.bids = [];
    t.phase = 'TO_PICK';
    // open a new announcement window
    t.createdAt = t.createdAt; // keep original creation for SLA accounting
    this.reassignAt.push({ taskId, at: -1 });
  }

  private reassignAt: { taskId: string; at: number }[] = [];

  tickReassignments(now: number) {
    for (let i = this.reassignAt.length - 1; i >= 0; i--) {
      const r = this.reassignAt[i];
      if (r.at < 0) {
        r.at = now + 0.6;
        continue;
      }
      if (now >= r.at) {
        const t = this.tasks.find((x) => x.id === r.taskId);
        if (t && t.state === 'REASSIGNING') {
          t.state = 'ANNOUNCED';
          t.announcedAt = now;
          t.failureReason = undefined;
          t.allocationReason = 'Awaiting reassignment evaluation.';
          t.trace.push({ at: now, event: 'REANNOUNCED', detail: 'Task returned to allocation after assignment recovery.' });
          this.pendingAnnouncements.push(t);
        }
        this.reassignAt.splice(i, 1);
      }
    }
  }

  begin(taskId: string, now: number) {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.state = 'IN_PROGRESS';
    t.startedAt = now;
    t.phase = 'TO_PICK';
    t.trace.push({ at: now, event: 'EXECUTION_STARTED', robotId: t.assignedTo ?? undefined, detail: 'Robot began navigating to pickup.' });
  }

  complete(taskId: string, now: number, warehouse: Warehouse) {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.state = 'COMPLETED';
    t.completedAt = now;
    t.phase = 'DONE';
    t.allocationReason = undefined;
    t.trace.push({ at: now, event: 'COMPLETED', robotId: t.assignedTo ?? undefined, detail: 'Delivery completed successfully.' });
    const dur = now - t.createdAt;
    this.completedTimes.push(dur);
    const pkg = t.packageId ? warehouse.packageById(t.packageId) : undefined;
    if (pkg) {
      pkg.state = 'DELIVERED';
      pkg.x = t.to.x;
      pkg.y = t.to.y;
      pkg.carrierId = undefined;
      pkg.taskId = undefined;
    }
    this.reannounceQueued(now);
  }

  fail(taskId: string, reason: string) {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.state = 'FAILED';
    t.failureReason = reason;
    t.trace.push({ at: t.startedAt ?? t.createdAt, event: 'FAILED', robotId: t.assignedTo ?? undefined, detail: reason });
  }

  releasePackage(taskId: string, warehouse: Warehouse) {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t?.packageId) return;
    const pkg = warehouse.packageById(t.packageId);
    if (pkg) {
      pkg.state = 'STORED';
      pkg.taskId = undefined;
      pkg.carrierId = undefined;
    }
  }

  get active() {
    return this.tasks.filter((t) => t.state === 'ASSIGNED' || t.state === 'IN_PROGRESS' || t.state === 'ANNOUNCED' || t.state === 'QUEUED' || t.state === 'REASSIGNING');
  }

  /** Reopen queued work as soon as a robot finishes, without waiting for a timer. */
  private reannounceQueued(now: number) {
    for (const task of this.tasks) {
      if (task.state !== 'QUEUED') continue;
      task.state = 'ANNOUNCED';
      task.announcedAt = now;
      task.bids = [];
      task.allocationReason = 'Robot became available; task returned to allocation.';
      this.evaluations = this.evaluations.filter((e) => e.taskId !== task.id);
      task.trace.push({ at: now, event: 'RECONSIDERED', detail: task.allocationReason });
      this.pendingAnnouncements.push(task);
    }
  }

  get completed() {
    return this.tasks.filter((t) => t.state === 'COMPLETED');
  }

  byId(id: string) {
    return this.tasks.find((t) => t.id === id);
  }

  /** Metrics for the experiments page. */
  metrics(now: number) {
    const completed = this.completedTimes;
    const avgCompletion = completed.length ? completed.reduce((a, b) => a + b, 0) / completed.length : 0;
    const windowMin = Math.max(1, now / 60);
    return {
      completedCount: completed.length,
      avgCompletion,
      throughput: completed.length / windowMin,
      reassignments: this.tasks.reduce((a, t) => a + t.reassignCount, 0),
      slaBreaches: this.tasks.filter((t) => t.state === 'COMPLETED' && t.completedAt !== undefined && t.completedAt - t.createdAt > t.slaSeconds).length,
    };
  }

  /** Free a package slot so the fleet can keep working indefinitely. */
  recycleDelivered(warehouse: Warehouse, rnd: Rng, count = 3) {
    const delivered = warehouse.packages.filter((p) => p.state === 'DELIVERED');
    for (let i = 0; i < Math.min(count, delivered.length); i++) {
      const p = delivered[i];
      const rack = warehouse.rackById(p.rackId);
      if (!rack) continue;
      const side = rack.pickFace!.x > rack.x ? 1 : -1;
      p.state = 'STORED';
      p.x = rack.x + side * (rack.w / 2 + 0.35);
      p.y = rack.y - rack.h / 2 + (0.15 + rnd() * 0.7) * rack.h;
      p.taskId = undefined;
    }
  }

  distanceTo(a: Vec2, b: Vec2) {
    return dist(a.x, a.y, b.x, b.y);
  }
}

export function stationById(id: string) {
  return STATIONS.find((s) => s.id === id);
}

export type { Package };
