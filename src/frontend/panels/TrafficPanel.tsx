import { AlertTriangle, ArrowLeftRight, X } from 'lucide-react'
import { Button, Chip, Dot, KV, Panel, ToggleChip } from '../../components/ui'
import { useNexus } from '../../store/useNexus'

export function TrafficPanel({ onClose }: { onClose: () => void }) {
  const snap = useNexus((s) => s.snapshot)
  const overlays = useNexus((s) => s.overlays)
  const toggle = useNexus((s) => s.toggleOverlay)
  const runScenario = useNexus((s) => s.runScenario)
  const clearObstacles = useNexus((s) => s.clearObstacles)
  const selectAgent = useNexus((s) => s.selectAgent)

  const waiting = snap.agents.filter((a) => a.status === 'WAITING' || a.status === 'BLOCKED')
  const conflicts = snap.traffic.slice(0, 14)

  return (
    <Panel
      className="nx-slide-in pointer-events-auto flex max-h-[calc(100vh-118px)] w-[430px] flex-col overflow-hidden"
      title={<span>TRAFFIC · spatial conflict management</span>}
      right={
        <button className="text-nx-faint hover:text-nx-text" onClick={onClose}>
          <X size={13} />
        </button>
      }
    >
      <div className="flex items-center gap-1.5 border-b border-nx-line/70 px-3 py-2">
        <span className="nx-h">Spatial overlays</span>
        <div className="ml-auto flex gap-1">
          <ToggleChip label="RISK" on={overlays.traffic} onClick={() => toggle('traffic')} tone="orange" />
          <ToggleChip label="DENSITY" on={overlays.density} onClick={() => toggle('density')} />
          <ToggleChip label="PERCEPTION" on={overlays.perception} onClick={() => toggle('perception')} />
          <ToggleChip label="PATHS" on={overlays.paths} onClick={() => toggle('paths')} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <div className="grid grid-cols-4 gap-2">
          <div>
            <div className="nx-h">Conflicts</div>
            <div className="font-mono text-[14px] text-nx-text">{snap.metrics.activeConflicts}</div>
          </div>
          <div>
            <div className="nx-h">Waiting</div>
            <div className={`font-mono text-[14px] ${waiting.length ? 'text-nx-amber' : 'text-nx-text'}`}>{waiting.length}</div>
          </div>
          <div>
            <div className="nx-h">Yields</div>
            <div className="font-mono text-[14px] text-nx-text">{snap.metrics.yieldCount}</div>
          </div>
          <div>
            <div className="nx-h">Separation events</div>
            <div className={`font-mono text-[14px] ${snap.metrics.collisionCount ? 'text-nx-red' : 'text-nx-green'}`}>{snap.metrics.collisionCount}</div>
          </div>
        </div>

        <div className="mt-3">
          <div className="nx-h mb-1">Waiting for right of way</div>
          {waiting.length === 0 && <div className="text-[11px] text-nx-faint">No agent is currently held</div>}
          {waiting.map((a) => (
            <div key={a.id} className="mt-1 flex items-center gap-2 rounded border border-nx-amber/30 bg-nx-amber/[0.06] px-2 py-1.5">
              <AlertTriangle size={11} className="text-nx-amber" />
              <button className="font-mono text-[11px] text-nx-text hover:underline" onClick={() => selectAgent(a.id)}>
                {a.id}
              </button>
              <span className="truncate text-[10px] text-nx-dim">{a.decision?.reason}</span>
              <span className="ml-auto font-mono text-[9.5px] text-nx-faint">{(a.context?.heldSeconds ?? 0).toFixed(0)}s</span>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <div className="nx-h mb-1">Live conflict log</div>
          <div className="space-y-1">
            {conflicts.map((e) => (
              <div key={e.id} className="rounded border border-nx-line/70 bg-nx-panel2/30 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Dot tone={e.severity > 0.7 ? 'red' : e.severity > 0.4 ? 'amber' : 'dim'} pulse={e.resolvedBy === 'PENDING'} />
                  <span className="font-mono text-[10.5px] text-nx-text">{e.agents.join(' ↔ ')}</span>
                  <Chip tone={e.kind === 'NEAR_MISS' ? 'red' : 'amber'} className="!px-1 !py-0">
                    {e.kind}
                  </Chip>
                  <span className="ml-auto font-mono text-[9.5px] text-nx-faint">{e.at.toFixed(1)}s</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 font-mono text-[9.5px] text-nx-faint">
                  <span>{e.ttc !== null ? `TTC ${e.ttc.toFixed(2)}s` : 'path overlap'}</span>
                  <span>@ ({e.position.x.toFixed(1)}, {e.position.z.toFixed(1)})</span>
                  <span className="ml-auto">{e.resolvedBy}</span>
                </div>
                <div className="text-[9.5px] text-nx-dim">{e.detail}</div>
              </div>
            ))}
            {conflicts.length === 0 && <div className="text-[11px] text-nx-faint">No conflicts recorded</div>}
          </div>
        </div>

        <div className="mt-3">
          <div className="nx-h mb-1">Right-of-way resolution</div>
          <div className="rounded border border-nx-line/70 bg-nx-panel2/30 px-2 py-1.5 text-[10px] leading-relaxed text-nx-dim">
            Each agent computes its own priority from task priority, load, execution mode and how long it has been held, then
            compares it with what it can see of the peer. Ties break deterministically on agent id, so both sides agree without
            a coordinator telling them what to do.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-nx-line/80 px-3 py-2">
        <Button onClick={() => runScenario('traffic_conflict')} title="Place two agents head-on in the same aisle">
          <ArrowLeftRight size={11} /> INJECT HEAD-ON CONFLICT
        </Button>
        <Button onClick={() => runScenario('blocked_aisle')}>BLOCK AISLE</Button>
        <Button onClick={clearObstacles} className="ml-auto">
          CLEAR OBSTACLES
        </Button>
      </div>
    </Panel>
  )
}

export function TrafficStrip() {
  const snapshot = useNexus((s) => s.snapshot)
  const risks = snapshot.collisionRisks.slice(0, 3)
  if (!risks.length) return null
  return (
    <Panel className="pointer-events-auto w-[262px]" dense title={<span>COLLISION RISK</span>} right={<Chip tone="amber">{snapshot.collisionRisks.length}</Chip>}>
      <div className="px-2.5 py-1.5">
        {risks.map((r) => (
          <div key={`${r.a}${r.b}`} className="flex items-center gap-2 py-1">
            <Dot tone={r.severity > 0.7 ? 'red' : 'amber'} pulse />
            <span className="font-mono text-[10px] text-nx-text">
              {r.a} ↔ {r.b}
            </span>
            <span className="ml-auto font-mono text-[9.5px] text-nx-dim">{r.ttc !== null ? `TTC ${r.ttc.toFixed(1)}s` : `${r.distance.toFixed(1)} m`}</span>
          </div>
        ))}
        <KV k="Severity" v={`${(Math.max(...risks.map((r) => r.severity)) * 100).toFixed(0)}%`} tone="amber" />
      </div>
    </Panel>
  )
}
