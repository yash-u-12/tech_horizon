import { FlaskConical, Play, RotateCw, X } from 'lucide-react'
import { Button, Chip, Divider, Dot, Panel } from '../../components/ui'
import { SCENARIOS, useNexus } from '../../store/useNexus'
import type { ExperimentMetrics } from '../../types'

const catTone = (c: string) => (c === 'FAILURE' ? 'red' : c === 'TRAFFIC' ? 'amber' : c === 'PHYSICAL' ? 'orange' : c === 'DEPLOYMENT' ? 'purple' : 'cyan')

const METRIC_ROWS: { key: keyof ExperimentMetrics; label: string; unit: string; better: 'up' | 'down' }[] = [
  { key: 'tasksCompleted', label: 'Tasks completed', unit: '', better: 'up' },
  { key: 'throughputPerHour', label: 'Throughput', unit: '/h', better: 'up' },
  { key: 'avgTaskTimeS', label: 'Avg task time', unit: 's', better: 'down' },
  { key: 'avgDelayS', label: 'Avg delay per agent', unit: 's', better: 'down' },
  { key: 'collisions', label: 'Body separations', unit: '', better: 'down' },
  { key: 'nearMisses', label: 'Near misses', unit: '', better: 'down' },
  { key: 'robotUtilization', label: 'Utilisation', unit: '%', better: 'up' },
  { key: 'replanCount', label: 'Replans', unit: '', better: 'down' },
  { key: 'yieldCount', label: 'Yields', unit: '', better: 'down' },
  { key: 'reassignmentCount', label: 'Reassignments', unit: '', better: 'down' },
  { key: 'avgSyncLatencyMs', label: 'Twin sync latency', unit: 'ms', better: 'down' },
  { key: 'deploymentTimeS', label: 'Last deployment time', unit: 's', better: 'down' },
  { key: 'distanceTravelledM', label: 'Fleet distance', unit: 'm', better: 'up' },
]

function fmt(m: ExperimentMetrics, key: keyof ExperimentMetrics, unit: string) {
  const v = m[key]
  if (v === null || v === undefined) return '—'
  if (key === 'robotUtilization') return `${(Number(v) * 100).toFixed(0)}%`
  if (typeof v === 'number') return `${v.toFixed(key === 'throughputPerHour' || key === 'avgTaskTimeS' ? 1 : 0)}${unit}`
  return String(v)
}

export function ExperimentsPanel({ onClose }: { onClose: () => void }) {
  const runScenario = useNexus((s) => s.runScenario)
  const captureBaseline = useNexus((s) => s.captureBaseline)
  const results = useNexus((s) => s.snapshot.experiments)
  const baseline = useNexus((s) => s.snapshot.baseline)
  const active = useNexus((s) => s.snapshot.activeScenario)
  const latest = results[0]

  return (
    <Panel
      className="nx-slide-in pointer-events-auto flex max-h-[calc(100vh-118px)] w-[520px] flex-col overflow-hidden"
      title={<span>EXPERIMENTS · controlled scenarios</span>}
      right={
        <div className="flex items-center gap-1.5">
          <Button onClick={captureBaseline} title="Snapshot current metrics as the comparison baseline">
            <RotateCw size={10} /> BASELINE
          </Button>
          <button className="text-nx-faint hover:text-nx-text" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {active && (
          <div className="mb-3 flex items-center gap-2 rounded border border-nx-cyan/40 bg-nx-cyan/[0.08] px-2.5 py-2">
            <Dot tone="cyan" pulse />
            <span className="text-[11px] text-nx-cyan">RUNNING · {active}</span>
            <span className="ml-auto font-mono text-[10px] text-nx-faint">recording metrics for comparison</span>
          </div>
        )}

        <div className="space-y-1.5">
          {SCENARIOS.map((s) => (
            <div key={s.id} className="rounded border border-nx-line/80 bg-nx-panel2/30 p-2">
              <div className="flex items-center gap-2">
                <Dot tone={catTone(s.category) as never} />
                <span className="text-[11px] text-nx-text">{s.label}</span>
                <Chip tone={catTone(s.category) as never} className="!px-1 !py-0 !text-[8.5px]">
                  {s.category}
                </Chip>
                <Button className="ml-auto !px-1.5 !py-0.5" onClick={() => runScenario(s.id)}>
                  <Play size={9} /> RUN
                </Button>
              </div>
              <p className="mt-1 text-[10.5px] leading-snug text-nx-dim">{s.description}</p>
              <p className="mt-0.5 text-[9.5px] leading-snug text-nx-faint">watch: {s.observe}</p>
            </div>
          ))}
        </div>

        {latest && (
          <>
            <Divider label="Latest result vs baseline" />
            <div className="overflow-hidden rounded border border-nx-line/80">
              <table className="w-full">
                <thead className="bg-nx-panel2/60">
                  <tr>
                    <th className="px-2 py-1 text-left font-mono text-[9px] uppercase tracking-[0.1em] text-nx-faint">Metric</th>
                    <th className="px-2 py-1 text-right font-mono text-[9px] uppercase tracking-[0.1em] text-nx-faint">Baseline</th>
                    <th className="px-2 py-1 text-right font-mono text-[9px] uppercase tracking-[0.1em] text-nx-faint">{latest.scenarioId}</th>
                    <th className="px-2 py-1 text-right font-mono text-[9px] uppercase tracking-[0.1em] text-nx-faint">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row) => {
                    const b = baseline?.[row.key]
                    const s2 = latest.metrics[row.key]
                    const delta = typeof b === 'number' && typeof s2 === 'number' ? s2 - b : null
                    const improved = delta === null ? null : row.better === 'up' ? delta > 0 : delta < 0
                    return (
                      <tr key={String(row.key)} className="border-t border-nx-line/50">
                        <td className="px-2 py-[3px] text-[10.5px] text-nx-dim">{row.label}</td>
                        <td className="px-2 py-[3px] text-right font-mono text-[10px] text-nx-faint">{baseline ? fmt(baseline, row.key, row.unit) : '—'}</td>
                        <td className="px-2 py-[3px] text-right font-mono text-[10px] text-nx-text">{fmt(latest.metrics, row.key, row.unit)}</td>
                        <td className={`px-2 py-[3px] text-right font-mono text-[10px] ${improved === null ? 'text-nx-faint' : improved ? 'text-nx-green' : 'text-nx-amber'}`}>
                          {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Divider label="Recorded runs" />
        <div className="space-y-1">
          {results.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded border border-nx-line/70 bg-nx-panel2/30 px-2 py-1.5">
              <FlaskConical size={11} className="text-nx-purple" />
              <span className="font-mono text-[10px] text-nx-text">{r.id}</span>
              <span className="text-[10.5px] text-nx-dim">{r.scenarioLabel}</span>
              <span className="ml-auto font-mono text-[9.5px] text-nx-faint">
                {r.durationS.toFixed(0)}s · {r.metrics.tasksCompleted} tasks · {r.metrics.replanCount} replans
              </span>
            </div>
          ))}
          {results.length === 0 && <div className="text-[10.5px] text-nx-faint">No experiments recorded yet — run a scenario to populate this table</div>}
        </div>
      </div>
    </Panel>
  )
}
