/**
 * AGENT → HARDWARE BINDING (§47A)
 *
 *   SELECT AGENT → DEPLOY TO PHYSICAL → SELECT HARDWARE → COMPATIBILITY
 *   → SAFETY VALIDATION → STOP + SAFE STATE → SYNCHRONISE → ACTIVE
 *
 * The agent keeps its identity, context, task, planner and coordination state
 * the entire time. Only its EXECUTION BACKEND changes:
 *
 *     R03.executionBackend : SimulationBackend  ⟶  PhysicalBackend(P01)
 *
 * There is no `if (robotId === 'R01')` anywhere in this system. Eligibility is
 * purely `checkCompatibility(agent, unit)`.
 */

import type { BindingState, CompatibilityReport, RobotState } from '../types';
import type { HardwareRegistry } from './hardware';
import { checkCompatibility } from './hardware';

export const BIND_TIMELINE = {
  CHECKING: 0.45,
  COMPAT_HOLD: 0.45,
  SAFETY_HOLD: 0.4,
  STOPPING: 0.7,
  SYNCHRONISING: 0.7,
  RELEASING: 0.9,
};

interface BindingJob {
  robotId: string;
  hardwareId: string;
  kind: 'BIND' | 'RELEASE' | 'REJECT';
  stage: string;
  t0: number;
  report: CompatibilityReport | null;
}

export class BindingController {
  private jobs = new Map<string, BindingJob>();
  /** emitted log consumed by the engine's event stream */
  log: { at: number; robotId: string; message: string; level: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL' }[] = [];

  constructor(private registry: HardwareRegistry) {}

  isBusy(robotId: string) {
    return this.jobs.has(robotId);
  }

  /** Stage 1: user asked to deploy this agent onto a physical unit. */
  beginBind(robotId: string, hardwareId: string, now: number, need: RobotState['capabilities']): CompatibilityReport {
    const unit = this.registry.get(hardwareId);
    const report = unit
      ? { ...checkCompatibility(robotId, need, unit), at: now }
      : {
          robotId,
          hardwareId,
          compatible: false,
          checks: [],
          score: 0,
          reason: 'HARDWARE UNIT NOT FOUND',
          at: now,
        };
    // An incompatible request must never enter the actuating pipeline at all.
    // It is parked in a REJECT job that only ever displays the failed report.
    const job: BindingJob = {
      robotId,
      hardwareId,
      kind: report.compatible ? 'BIND' : 'REJECT',
      stage: 'CHECKING',
      t0: now,
      report,
    };
    this.jobs.set(robotId, job);
    this.emit(
      now,
      robotId,
      report.compatible
        ? `BINDING REQUEST ${robotId} → ${hardwareId}`
        : `BINDING REJECTED ${robotId} → ${hardwareId}: ${report.reason}`,
      report.compatible ? 'INFO' : 'CRITICAL',
    );
    return report;
  }

  beginRelease(robotId: string, now: number) {
    this.jobs.set(robotId, { robotId, hardwareId: '', kind: 'RELEASE', stage: 'RELEASING', t0: now, report: null });
    this.emit(now, robotId, `RELEASING HARDWARE FROM ${robotId}`, 'INFO');
  }

  cancel(robotId: string) {
    this.jobs.delete(robotId);
  }

  /**
   * Advance every in-flight binding. Returns the set of agents whose backend
   * must actually be swapped this tick (the engine performs the swap).
   */
  tick(
    now: number,
    agents: RobotState[],
  ): { robotId: string; kind: 'BIND' | 'RELEASE'; hardwareId: string }[] {
    const completed: { robotId: string; kind: 'BIND' | 'RELEASE'; hardwareId: string }[] = [];
    for (const [robotId, job] of [...this.jobs]) {
      const agent = agents.find((a) => a.id === robotId);
      if (!agent) {
        this.jobs.delete(robotId);
        continue;
      }
      const bs = agent.binding;
      const elapsed = now - job.t0;

      if (job.kind === 'REJECT') {
        const hold = BIND_TIMELINE.CHECKING + BIND_TIMELINE.COMPAT_HOLD;
        bs.report = job.report;
        bs.progress = 0.25;
        bs.message = `INCOMPATIBLE · ${job.report ? job.report.reason ?? 'UNKNOWN' : 'UNKNOWN'}`;
        if (elapsed < hold) {
          bs.stage = 'COMPATIBILITY_FAIL';
          continue;
        }
        bs.stage = 'IDLE';
        bs.hardwareId = null;
        bs.hardwareClass = 'NONE';
        bs.progress = 0;
        bs.message = 'BINDING REJECTED · SIMULATION EXECUTION';
        this.jobs.delete(robotId);
        continue;
      }

      if (job.kind === 'BIND') {
        if (elapsed < BIND_TIMELINE.CHECKING) {
          bs.stage = 'CHECKING';
          bs.progress = elapsed / BIND_TIMELINE.CHECKING * 0.25;
          bs.message = 'Reading hardware capability manifest…';
        } else if (elapsed < BIND_TIMELINE.CHECKING + BIND_TIMELINE.COMPAT_HOLD) {
          bs.report = job.report;
          bs.stage = 'COMPATIBILITY_OK';
          bs.progress = 0.4;
          const rep = job.report;
          bs.message = rep
            ? `COMPATIBLE — ${rep.checks.filter((c) => c.pass).length}/${rep.checks.length} checks passed`
            : 'COMPATIBILITY REPORT UNAVAILABLE';
          if (bs.report !== job.report) this.emit(now, robotId, `COMPATIBILITY OK ${robotId} → ${job.hardwareId}`, 'SUCCESS');
        } else if (elapsed < BIND_TIMELINE.CHECKING + BIND_TIMELINE.COMPAT_HOLD + BIND_TIMELINE.SAFETY_HOLD) {
          bs.stage = 'SAFETY_HOLD';
          bs.progress = 0.55;
          bs.message = 'Safety validation · geofence, speed envelope, E-STOP state';
        } else if (elapsed < BIND_TIMELINE.CHECKING + BIND_TIMELINE.COMPAT_HOLD + BIND_TIMELINE.SAFETY_HOLD + BIND_TIMELINE.STOPPING) {
          bs.stage = 'STOPPING';
          bs.progress = 0.72;
          bs.message = 'Commanding hardware to safe state · zero velocity';
        } else if (elapsed < BIND_TIMELINE.CHECKING + BIND_TIMELINE.COMPAT_HOLD + BIND_TIMELINE.SAFETY_HOLD + BIND_TIMELINE.STOPPING + BIND_TIMELINE.SYNCHRONISING) {
          bs.stage = 'SYNCHRONISING';
          bs.progress = 0.9;
          bs.message = 'Synchronising agent state ↔ hardware telemetry';
        } else {
          bs.stage = 'ACTIVE';
          bs.progress = 1;
          bs.hardwareId = job.hardwareId;
          bs.message = `DEPLOYED ON ${job.hardwareId}`;
          bs.hardwareClass = this.registry.get(job.hardwareId)?.mock ? 'MOCK' : 'PHYSICAL';
          this.emit(now, robotId, `${robotId} NOW EXECUTING ON ${job.hardwareId} (${bs.hardwareClass})`, 'SUCCESS');
          completed.push({ robotId, kind: 'BIND', hardwareId: job.hardwareId });
          this.jobs.delete(robotId);
        }
      } else {
        if (elapsed < BIND_TIMELINE.RELEASING) {
          bs.stage = 'RELEASING';
          bs.progress = 1 - elapsed / BIND_TIMELINE.RELEASING;
          bs.message = 'Stopping hardware · clearing command queue · safe state';
        } else {
          const hw = bs.hardwareId;
          this.emit(now, robotId, `${robotId} RELEASED FROM ${hw} · RETURNED TO SIMULATION`, 'INFO');
          bs.stage = 'IDLE';
          bs.hardwareId = null;
          bs.hardwareClass = 'NONE';
          bs.progress = 0;
          bs.report = null;
          bs.message = 'SIMULATION EXECUTION';
          completed.push({ robotId, kind: 'RELEASE', hardwareId: hw ?? '' });
          this.jobs.delete(robotId);
        }
      }
    }
    return completed;
  }

  private emit(at: number, robotId: string, message: string, level: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL') {
    this.log.push({ at, robotId, message, level });
    if (this.log.length > 300) this.log.shift();
  }
}

export function makeBindingState(): BindingState {
  return {
    stage: 'IDLE',
    hardwareId: null,
    hardwareClass: 'NONE',
    progress: 0,
    message: 'SIMULATION EXECUTION',
    startedAt: null,
    report: null,
    rejectedCommands: 0,
  };
}
