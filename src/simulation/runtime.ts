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
  orderInterval: 7,
  maxActiveTasks: 7,
};

class Runtime {
  engine: SimulationEngine;
  private raf = 0;
  private last = 0;
  private subs = new Set<(s: Snapshot) => void>();
  private started = false;
  private unsub: (() => void) | null = null;

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
    cancelAnimationFrame(this.raf);
    this.started = false;
  }

  /** Rebuild the world from scratch, optionally with a new configuration. */
  rebuild(cfg?: Partial<EngineConfig>) {
    this.unsub?.();
    this.engine = new SimulationEngine({ ...this.engine.cfg, ...cfg });
    this.unsub = this.engine.subscribe((s) => this.subs.forEach((f) => f(s)));
    this.emit();
  }

  reset() {
    this.engine.reset();
    this.emit();
  }

  subscribe(fn: (s: Snapshot) => void) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit() {
    this.subs.forEach((f) => f(this.engine.getSnapshot()));
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
