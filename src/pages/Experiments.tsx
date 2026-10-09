/**
 * EXPERIMENTS / DEMO MODE (§38)
 *
 * Runs the simulation HEADLESS — no rendering, no UI coupling — for identical
 * seeded durations with and without a scenario, then reports the real deltas
 * from the real metrics accumulator. Nothing here is fabricated.
 */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { BarChart3, FlaskConical, Loader2, Play, RotateCcw, Sigma } from 'lucide-react';
import { SimulationEngine } from '@/simulation/engine';
import { SCENARIOS } from '@/simulation/scenarios/scenarios';
import { DEFAULT_CONFIG } from '@/simulation/runtime';
import { useNexus } from '@/store/useNexus';
import { Chip, KV, Panel, Stat, type Tone } from '@/components/ui';
import type { ExperimentResult, ExperimentMetrics } from '@/simulation/types';

const RUNS = 3;
const DURATION = 60;

const METRIC_DEFS: {
  key: keyof ExperimentMetrics;
  label: string;
  unit?: string;
  /** lower is better? */
  lowerBetter: boolean;
  fmt: (v: number) => string;
  group: 'THROUGHPUT' | 'SAFETY' | 'COORDINATION' | 'EFFICIENCY';
}[] = [
  { key: 'tasksCompleted', label: 'TASKS COMPLETED', lowerBetter: false, fmt: (v) => v.toFixed(1), group: 'THROUGHPUT' },
  { key: 'throughputPerMin', label: 'THROUGHPUT', unit: '/min', lowerBetter: false, fmt: (v) => v.toFixed(2), group: 'THROUGHPUT' },
  { key: 'slaBreaches', label: 'SLA BREACHES', lowerBetter: true, fmt: (v) => v.toFixed(1), group: 'THROUGHPUT' },
  { key: 'nearMisses', label: 'NEAR MISSES', lowerBetter: true, fmt: (v) => v.toFixed(1), group: 'SAFETY' },
  { key: 'conflictsResolved', label: 'CONFLICTS RESOLVED', lowerBetter: false, fmt: (v) => v.toFixed(1), group: 'SAFETY' },
  { key: 'replans', label: 'REPLANS', lowerBetter: true, fmt: (v) => v.toFixed(1), group: 'COORDINATION' },
  { key: 'reassignments', label: 'REASSIGNMENTS', lowerBetter: true, fmt: (v) => v.toFixed(1), group: 'COORDINATION' },
  { key: 'avgReassignmentTime', label: 'REASSIGN TIME', unit: 's', lowerBetter: true, fmt: (v) => v.toFixed(2), group: 'COORDINATION' },
  { key: 'avgDelay', label: 'AVG DELAY', unit: 's', lowerBetter: true, fmt: (v) => v.toFixed(2), group: 'EFFICIENCY' },
  { key: 'distanceTravelled', label: 'DISTANCE', unit: 'm', lowerBetter: true, fmt: (v) => v.toFixed(0), group: 'EFFICIENCY' },
  { key: 'robotUtilisation', label: 'UTILISATION', lowerBetter: false, fmt: (v) => `${(v * 100).toFixed(0)}%`, group: 'EFFICIENCY' },
  { key: 'energyConsumed', label: 'ENERGY', lowerBetter: true, fmt: (v) => v.toFixed(1), group: 'EFFICIENCY' },
];

export function Experiments() {
  const snap = useNexus((s) => s.snap);
  const experiments = useNexus((s) => s.experiments);
  const setExperiments = useNexus((s) => s.setExperiments);
  const notify = useNexus((s) => s.notify);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const scenarios = SCENARIOS.filter((s) => s.id !== 'A');

  const run = async (scenarioId: string) => {
    setRunning(scenarioId);
    setProgress(0);
    // yield a frame so the UI paints the running state before the blocking work
    await new Promise((r) => setTimeout(r, 30));

    const acc = (m: ExperimentMetrics[]): ExperimentMetrics => {
      const out = {} as ExperimentMetrics;
      for (const d of METRIC_DEFS) {
        out[d.key] = m.reduce((a, x) => a + (x[d.key] as number), 0) / m.length;
      }
      return out;
    };

    const baselineRuns: ExperimentMetrics[] = [];
    const scenarioRuns: ExperimentMetrics[] = [];
    for (let i = 0; i < RUNS; i++) {
      baselineRuns.push(SimulationEngine.runHeadless(DEFAULT_CONFIG, DURATION));
      setProgress((i + 0.5) / RUNS);
      await new Promise((r) => setTimeout(r, 0));
      scenarioRuns.push(
        SimulationEngine.runHeadless(DEFAULT_CONFIG, DURATION, scenarioId, 20),
      );
      setProgress((i + 1) / RUNS);
      await new Promise((r) => setTimeout(r, 0));
    }

    const sc = SCENARIOS.find((s) => s.id === scenarioId)!;
    const result: ExperimentResult = {
      id: `EXP-${String(experiments.length + 1).padStart(2, '0')}`,
      name: sc.name,
      scenarioId,
      baseline: acc(baselineRuns),
      scenario: acc(scenarioRuns),
      at: Date.now(),
      durationSeconds: DURATION,
      runs: RUNS,
      notes: `${RUNS} seeded runs × ${DURATION}s · seed ${DEFAULT_CONFIG.seed} · scenario injected at t=20s`,
    };
    setExperiments([result, ...experiments]);
    setRunning(null);
    notify(`${result.id} COMPLETE · ${RUNS} SEEDED RUNS × ${DURATION}s`, 'SUCCESS');
  };

  const latest = experiments[0] ?? null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-void p-3">
      {/* ── explanation ─────────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-start gap-3 rounded-md border border-line2 bg-abyss/50 px-3 py-2.5">
        <Sigma size={14} className="mt-[1px] shrink-0 text-analysis" />
        <div className="text-[11px] leading-relaxed text-txt2">
          <b className="text-txt">CONTROLLED TRIALS.</b> Each trial runs the same engine{' '}
          <b className="mono">{RUNS}×</b> for <b className="mono">{DURATION}s</b> of simulated time with the
          same seed — once unperturbed, once with the scenario injected at t=20s. The engine runs
          headless: identical code path, identical metrics, no rendering. Reported numbers are the mean
          across runs.
        </div>
      </div>

      {/* ── live metrics ───────────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-6 gap-3">
        <div className="panel p-3"><Stat label="LIVE COMPLETED" value={`${snap.fleet.tasksCompleted}`} tone="ok" /></div>
        <div className="panel p-3"><Stat label="LIVE THROUGHPUT" value={snap.fleet.throughputPerMin.toFixed(2)} unit="/min" tone="nav" /></div>
        <div className="panel p-3"><Stat label="LIVE REPLANS" value={`${snap.metrics.replans}`} tone="analysis" /></div>
        <div className="panel p-3"><Stat label="LIVE REASSIGNS" value={`${snap.metrics.reassignments}`} tone="warn" /></div>
        <div className="panel p-3"><Stat label="LIVE NEAR MISS" value={`${snap.metrics.nearMisses}`} tone={snap.metrics.nearMisses ? 'warn' : 'ok'} /></div>
        <div className="panel p-3"><Stat label="LIVE UTILISATION" value={`${(snap.metrics.robotUtilisation * 100).toFixed(0)}`} unit="%" /></div>
      </div>

      <div className="grid grid-cols-[1fr_420px] gap-3">
        {/* ── trial list ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <FlaskConical size={12} className="text-txt3" />
                RUN A TRIAL
              </span>
            }
            dense
          >
            <div className="grid grid-cols-1 gap-1.5 p-3">
              {scenarios.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded border border-line2 bg-abyss/40 px-3 py-2"
                >
                  <span
                    className={clsx(
                      'mono text-[12px] font-bold',
                      s.severity === 'CRITICAL' ? 'text-danger' : s.severity === 'WARNING' ? 'text-warn' : 'text-txt3',
                    )}
                  >
                    {s.id}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-2xs font-semibold uppercase tracking-[0.1em] text-txt">{s.name}</div>
                    <div className="truncate text-3xs text-txt3">{s.description}</div>
                  </div>
                  {running === s.id ? (
                    <div className="flex w-[132px] items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-line2">
                        <div className="h-full bg-nav transition-[width]" style={{ width: `${progress * 100}%` }} />
                      </div>
                      <Loader2 size={12} className="animate-spin text-nav" />
                    </div>
                  ) : (
                    <button className="btn btn-primary w-[132px] justify-center" disabled={!!running} onClick={() => run(s.id)}>
                      <Play size={11} />
                      RUN {RUNS}×{DURATION}s
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          {/* ── results ───────────────────────────────────────────────────── */}
          {latest && (
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <BarChart3 size={12} className="text-txt3" />
                  LATEST RESULT · {latest.id} · {latest.name}
                </span>
              }
              right={
                <span className="mono text-3xs text-txt3">
                  {latest.runs} RUNS × {latest.durationSeconds}s · SEED {DEFAULT_CONFIG.seed}
                </span>
              }
              dense
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <thead>
                    <tr className="bg-abyss/70">
                      <th className="th text-left">METRIC</th>
                      <th className="th text-right">BASELINE</th>
                      <th className="th text-right">WITH SCENARIO</th>
                      <th className="th text-right">DELTA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {METRIC_DEFS.map((d) => {
                      const b = latest.baseline[d.key] as number;
                      const s = latest.scenario[d.key] as number;
                      const diff = s - b;
                      const pct = b !== 0 ? (diff / Math.abs(b)) * 100 : 0;
                      const improved = d.lowerBetter ? diff < 0 : diff > 0;
                      const flat = Math.abs(pct) < 0.5;
                      const tone: Tone = flat ? 'default' : improved ? 'ok' : 'danger';
                      return (
                        <tr key={String(d.key)} className="border-t border-line/50">
                          <td className="px-3 py-1.5 text-[11px] text-txt2">
                            {d.label}
                            {d.unit && <span className="ml-1 text-3xs text-txt3">{d.unit}</span>}
                          </td>
                          <td className="mono px-3 py-1.5 text-right text-[11px] text-txt">{d.fmt(b)}</td>
                          <td className="mono px-3 py-1.5 text-right text-[11px] text-txt">{d.fmt(s)}</td>
                          <td className="mono px-3 py-1.5 text-right text-[11px]">
                            <span className={tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : 'text-txt3'}>
                              {diff >= 0 ? '+' : ''}
                              {d.fmt(diff)}
                              <span className="ml-1 text-3xs opacity-70">
                                ({pct >= 0 ? '+' : ''}
                                {pct.toFixed(0)}%)
                              </span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-line px-3 py-2 text-3xs leading-relaxed text-txt3">
                Green means the fleet degraded gracefully — the scenario is a perturbation, so most
                metrics move the wrong way. What matters for the demo is that throughput does not
                collapse, SLA breaches stay bounded and conflicts get resolved rather than deadlocked.
              </div>
            </Panel>
          )}

          {experiments.length > 1 && (
            <Panel title="TRIAL HISTORY" dense>
              <div className="divide-y divide-line/50">
                {experiments.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="mono text-[11px] text-txt">{e.id}</span>
                    <span className="text-2xs text-txt2">{e.name}</span>
                    <span className="mono ml-auto text-3xs text-txt3">
                      {e.baseline.tasksCompleted.toFixed(1)} → {e.scenario.tasksCompleted.toFixed(1)} tasks
                    </span>
                    <span className="mono text-3xs text-txt3">
                      {e.baseline.nearMisses.toFixed(1)} → {e.scenario.nearMisses.toFixed(1)} near miss
                    </span>
                  </div>
                ))}
                <div className="flex justify-end px-3 py-1.5">
                  <button className="btn" onClick={() => setExperiments([])}>
                    <RotateCcw size={11} />
                    CLEAR HISTORY
                  </button>
                </div>
              </div>
            </Panel>
          )}
        </div>

        {/* ── live experiment state ───────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <Panel title="CURRENT SESSION METRICS" dense>
            <div className="p-3">
              <KV k="TASKS COMPLETED" v={`${snap.metrics.tasksCompleted}`} tone="ok" />
              <KV k="TASKS FAILED" v={`${snap.metrics.tasksFailed}`} tone={snap.metrics.tasksFailed ? 'danger' : 'default'} />
              <KV k="AVG COMPLETION" v={`${snap.metrics.avgCompletionTime.toFixed(1)}s`} />
              <KV k="AVG DELAY" v={`${snap.metrics.avgDelay.toFixed(2)}s`} />
              <KV k="REPLANS" v={`${snap.metrics.replans}`} tone="analysis" />
              <KV k="REASSIGNMENTS" v={`${snap.metrics.reassignments}`} tone="warn" />
              <KV k="AVG REASSIGN TIME" v={`${snap.metrics.avgReassignmentTime.toFixed(2)}s`} />
              <KV k="CONFLICTS RESOLVED" v={`${snap.metrics.conflictsResolved}`} tone="ok" />
              <KV k="NEAR MISSES" v={`${snap.metrics.nearMisses}`} tone={snap.metrics.nearMisses ? 'warn' : 'ok'} />
              <KV k="DISTANCE" v={`${snap.metrics.distanceTravelled.toFixed(0)}m`} />
              <KV k="ENERGY" v={`${snap.metrics.energyConsumed.toFixed(1)}`} />
              <KV k="SLA BREACHES" v={`${snap.metrics.slaBreaches}`} tone={snap.metrics.slaBreaches ? 'danger' : 'ok'} />
            </div>
          </Panel>

          <Panel title="SCENARIO HISTORY" dense className="min-h-0 flex-1">
            <div className="h-full overflow-auto">
              {snap.scenarioHistory.length === 0 && (
                <div className="p-4 text-center text-[11px] text-txt3">NO SCENARIOS RUN THIS SESSION</div>
              )}
              {[...snap.scenarioHistory].reverse().map((h, i) => (
                <div key={i} className="flex items-center gap-2 border-b border-line/40 px-3 py-1.5 last:border-0">
                  <Chip tone="nav">{h.id}</Chip>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-txt2">{h.name}</span>
                  <span className="mono text-3xs text-txt3">t={h.at.toFixed(1)}s</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="DEMO SCRIPT" dense>
            <ol className="list-decimal space-y-1 p-3 pl-7 text-[11px] leading-relaxed text-txt2">
              <li>Command center: six agents plan, bid and navigate on their own.</li>
              <li>Select any agent → read its own context and last decision.</li>
              <li>Drop an obstacle on the floor → watch only the affected agent replan.</li>
              <li>Inject a robot failure → its task returns to the auction and is reassigned.</li>
              <li>Digital Twin → deploy a virtual agent onto physical hardware, staged.</li>
              <li>Transfer that hardware to a different agent — identity is preserved, ownership is not.</li>
              <li>Run a trial here to quantify what the perturbation cost.</li>
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function useExperiments() {
  return useNexus((s) => s.experiments);
}

const _unused = useMemo;
