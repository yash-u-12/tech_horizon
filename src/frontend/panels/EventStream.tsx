import { useState } from 'react'
import { Chip, Dot, Panel } from '../../components/ui'
import { useNexus } from '../../store/useNexus'

const levelTone = (l: string) => (l === 'CRITICAL' ? 'red' : l === 'WARN' ? 'amber' : l === 'SUCCESS' ? 'green' : l === 'DECISION' ? 'purple' : 'neutral')

export function EventStream() {
  const events = useNexus((s) => s.snapshot.events)
  const [filter, setFilter] = useState<'ALL' | 'AGENT' | 'SYSTEM'>('ALL')
  const [open, setOpen] = useState(true)

  const shown = events.filter((e) => {
    if (filter === 'AGENT') return e.level === 'DECISION'
    if (filter === 'SYSTEM') return e.level !== 'DECISION'
    return true
  })

  return (
    <Panel
      className="pointer-events-auto flex h-[236px] w-[420px] flex-col overflow-hidden"
      dense
      title={
        <span className="flex items-center gap-2">
          EVENT STREAM
          <span className="font-mono text-[9px] text-nx-faint">{events.length}</span>
        </span>
      }
      right={
        <div className="flex items-center gap-1">
          {(['ALL', 'AGENT', 'SYSTEM'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded border px-1 py-0.5 font-mono text-[8.5px] tracking-wide ${
                filter === f ? 'border-nx-cyan/40 bg-nx-cyan/10 text-nx-cyan' : 'border-nx-line2/60 text-nx-faint hover:text-nx-dim'
              }`}
            >
              {f}
            </button>
          ))}
          <button className="px-1 font-mono text-[9px] text-nx-faint hover:text-nx-dim" onClick={() => setOpen(!open)}>
            {open ? '−' : '+'}
          </button>
        </div>
      }
    >
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          {shown.map((e) => (
            <div key={e.id} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-nx-line/20">
              <span className="mt-[2px] font-mono text-[9px] tabular-nums text-nx-faint">{e.at.toFixed(1)}</span>
              <Dot tone={levelTone(e.level)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[9.5px] text-nx-dim">{e.source}</span>
                  <span className={`truncate text-[10.5px] ${e.level === 'CRITICAL' ? 'text-nx-red' : e.level === 'WARN' ? 'text-nx-amber' : 'text-nx-text'}`}>
                    {e.message}
                  </span>
                </div>
                {e.detail && <div className="truncate font-mono text-[9px] text-nx-faint">{e.detail}</div>}
              </div>
            </div>
          ))}
          {shown.length === 0 && <div className="px-2 py-4 text-center text-[10.5px] text-nx-faint">no events</div>}
        </div>
      )}
    </Panel>
  )
}

export function MeshFeed() {
  const snap = useNexus((s) => s.snapshot)
  const intents = snap.meshTraffic
  return (
    <Panel
      className="pointer-events-auto w-[262px]"
      dense
      title={<span>PEER INTENT MESH</span>}
      right={<Chip tone="neutral">{intents.delivered} delivered</Chip>}
    >
      <div className="px-2.5 py-2 font-mono text-[9.5px] leading-relaxed text-nx-faint">
        <div className="flex justify-between">
          <span>sent</span>
          <span className="text-nx-dim">{intents.sent}</span>
        </div>
        <div className="flex justify-between">
          <span>dropped</span>
          <span className={intents.dropped > 0 ? 'text-nx-amber' : 'text-nx-dim'}>{intents.dropped}</span>
        </div>
        <div className="mt-1.5 text-[9px] leading-snug">
          Agents publish route reservations and yield notices over a 14 m radio mesh. Nothing here issues commands — it is how
          the fleet tells each other what it intends to do.
        </div>
      </div>
    </Panel>
  )
}
