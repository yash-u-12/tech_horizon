/**
 * SIMULATION RUNTIME
 *
 * Owns the single SimulationEngine instance and drives it from a
 * requestAnimationFrame loop. Deliberately outside React: the 3D scene reads
 * agent state directly every frame, while React only sees 10 Hz snapshots.
 */

import { SimulationEngine, type EngineConfig, type Snapshot } from './engine';

export const DEFAULT_CONFIG: EngineConfig = {
  seed: 20261007,
  robotCount: 6,
};

export interface TaskGenerationSession {
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  created: number;
  target: 5;
  nextAt: number | null;
  error: string | null;
}

class Runtime {
  engine: SimulationEngine;
  private raf = 0;
  private last = 0;
  private subs = new Set<(s: Snapshot) => void>();
  private started = false;
  private unsub: (() => void) | null = null;
  private generationTimer: ReturnType<typeof setTimeout> | null = null;
  private generationListeners = new Set<(session: TaskGenerationSession) => void>();
  taskGeneration: TaskGenerationSession = { status: 'IDLE', created: 0, target: 5, nextAt: null, error: null };

  constructor(cfg: EngineConfig = DEFAULT_CONFIG) {
    this.engine = new SimulationEngine(cfg);
    this.unsub = this.engine.subscribe((s) => this.subs.forEach((f) => f(s)));
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(now - this.last, 250);
      this.last = now;
      this.engine.advance(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.cancelTaskGeneration();
    cancelAnimationFrame(this.raf);
    this.started = false;
  }

  /** Rebuild the world from scratch, optionally with a new configuration. */
  rebuild(cfg?: Partial<EngineConfig>) {
    this.cancelTaskGeneration();
    this.unsub?.();
    this.engine = new SimulationEngine({ ...this.engine.cfg, ...cfg });
    this.unsub = this.engine.subscribe((s) => this.subs.forEach((f) => f(s)));
    this.emit();
  }

  reset() {
    this.cancelTaskGeneration();
    this.engine.reset();
    this.emit();
  }

  subscribe(fn: (s: Snapshot) => void) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit() {
    this.engine.publishNow();
  }

  subscribeTaskGeneration(fn: (session: TaskGenerationSession) => void) {
    this.generationListeners.add(fn);
    fn(this.taskGeneration);
    return () => this.generationListeners.delete(fn);
  }

  startTaskGeneration() {
    if (this.taskGeneration.status === 'RUNNING') return false;
    this.taskGeneration = { status: 'RUNNING', created: 0, target: 5, nextAt: Date.now() + 10_000, error: null };
    this.publishGeneration();
    this.scheduleGeneratedTask();
    return true;
  }

  private scheduleGeneratedTask() {
    if (this.taskGeneration.status !== 'RUNNING' || this.taskGeneration.nextAt === null) return;
    const delay = Math.max(0, this.taskGeneration.nextAt - Date.now());
    this.generationTimer = setTimeout(() => {
      this.generationTimer = null;
      const task = this.engine.createGeneratedOrder();
      if (!task) {
        this.taskGeneration = { ...this.taskGeneration, status: 'FAILED', nextAt: null, error: 'No unreserved packages are available to create a task.' };
        this.publishGeneration();
        return;
      }
      const created = this.taskGeneration.created + 1;
      this.taskGeneration = {
        status: created === this.taskGeneration.target ? 'COMPLETED' : 'RUNNING',
        created,
        target: this.taskGeneration.target,
        nextAt: created === this.taskGeneration.target ? null : Date.now() + 10_000,
        error: null,
      };
      this.emit();
      this.publishGeneration();
      this.scheduleGeneratedTask();
    }, delay);
  }

  private cancelTaskGeneration() {
    if (this.generationTimer) clearTimeout(this.generationTimer);
    this.generationTimer = null;
    if (this.taskGeneration.status === 'RUNNING') {
      this.taskGeneration = { status: 'IDLE', created: 0, target: 5, nextAt: null, error: null };
      this.publishGeneration();
    }
  }

  private publishGeneration() {
    this.generationListeners.forEach((fn) => fn(this.taskGeneration));
  }

  get snapshot() {
    return this.engine.getSnapshot();
  }

  /** Tasks completed in each 10 s bucket, for the throughput sparkline. */
  throughputHistory(buckets = 24, bucketSeconds = 10): number[] {
    const done = this.engine.tasks.tasks
      .filter((t) => t.completedAt != null)
      .map((t) => t.completedAt as number)
      .sort((a, b) => a - b);
    const now = this.engine.time;
    const out: number[] = [];
    for (let i = buckets - 1; i >= 0; i--) {
      const lo = now - (i + 1) * bucketSeconds;
      const hi = now - i * bucketSeconds;
      out.push(done.filter((t) => t >= lo && t < hi).length);
    }
    return out;
  }
}

export const runtime = new Runtime();
