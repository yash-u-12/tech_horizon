import { Search, X } from 'lucide-react'
import { useState } from 'react'
import { Bar, Chip, Dot, Panel } from '../../components/ui'
import { useNexus } from '../../store/useNexus'

const batteryTone = (b: number) => (b < 0.15 ? 'red' : b < 0.3 ? 'amber' : b < 0.6 ? 'cyan' : 'green')

export function FleetPanel({ onClose }: { onClose: () => void }) {
  const agents = useNexus((s) => s.snapshot.agents)
  const bindings = useNexus((s) => s.snapshot.bindings)
  const hardware = useNexus((s) => s.snapshot.hardware)
  const selectedAgentId = useNexus((s) => s.selectedAgentId)
  const selectAgent = useNexus((s) => s.selectAgent)
  const setFollow = useNexus((s) => s.setFollow)
  const openDeploy = useNexus((s) => s.openDeploy)
  const unbind = useNexus((s) => s.unbind)
  const [filter, setFilter] = useState<'ALL' | 'SIM' | 'PHYSICAL' | 'ATTENTION'>('ALL')
  const [q, setQ] = useState('')

  const rows = agents.filter((a) => {
    if (q && !a.id.toLowerCase().includes(q.toLowerCase()) && !(a.taskId ?? '').toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'SIM') return !a.hardwareId
    if (filter === 'PHYSICAL') return !!a.hardwareId
    if (filter === 'ATTENTION') return !!a.fault || a.status === 'BLOCKED' || a.status === 'WAITING' || a.battery < 0.2
    return true
  })

  return (
    <Panel
      className="nx-slide-in pointer-events-auto flex max-h-[calc(100vh-118px)] w-[520px] flex-col overflow-hidden"
      title={<span>FLEET · agents and execution bodies</span>}
      right={
        <button className="text-nx-faint hover:text-nx-text" onClick={onClose}>
          <X size={13} />
        </button>
      }
    >
      <div className="flex items-center gap-2 border-b border-nx-line/70 px-3 py-2">
        <div className="flex flex-1 items-center gap-1.5 rounded border border-nx-line2/60 bg-nx-panel2/50 px-2 py-1">
          <Search size={11} className="text-nx-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search agent or task"
            className="w-full bg-transparent font-mono text-[11px] text-nx-text outline-none placeholder:text-nx-faint"
          />
        </div>
        {(['ALL', 'SIM', 'PHYSICAL', 'ATTENTION'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded border px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-wide ${
              filter === f ? 'border-nx-cyan/40 bg-nx-cyan/10 text-nx-cyan' : 'border-nx-line2/60 text-nx-faint hover:text-nx-dim'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-nx-panel/95 backdrop-blur">
            <tr className="text-left">
              {['AGENT', 'MODE', 'STATUS', 'BATTERY', 'TASK', 'VEL', 'LINK', 'BODY / TWIN'].map((h) => (
                <th key={h} className="px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-nx-faint">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const binding = bindings.find((b) => b.agentId === a.id)
              const hw = hardware.find((h) => h.id === a.hardwareId)
              const active = selectedAgentId === a.id
              return (
                <tr
                  key={a.id}
                  onClick={() => {
                    selectAgent(a.id)
                    setFollow(a.id)
                  }}
                  className={`cursor-pointer border-t border-nx-line/50 ${active ? 'bg-nx-cyan/[0.07]' : 'hover:bg-nx-line/20'}`}
                >
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Dot tone={a.fault ? 'red' : a.hardwareId ? 'orange' : 'cyan'} pulse={a.velocity > 0.05} />
                      <span className="font-mono text-[11px] text-nx-text">{a.id}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-nx-faint">{a.profile}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <Chip tone={a.hardwareId ? 'orange' : 'cyan'}>{a.hardwareId ? 'PHYSICAL' : 'SIM'}</Chip>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`font-mono text-[10px] ${a.fault ? 'text-nx-red' : a.status === 'BLOCKED' || a.status === 'WAITING' ? 'text-nx-amber' : 'text-nx-dim'}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-nx-text">{(a.battery * 100) | 0}%</span>
                      <Bar value={a.battery} tone={batteryTone(a.battery)} height={3} className="w-8" />
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-nx-dim">{a.taskId ?? '—'}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-nx-dim">{a.velocity.toFixed(2)}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-nx-dim">
                    {binding?.syncState === 'SYNCED' ? `${a.twin?.latencyMs.toFixed(0) ?? '—'} ms` : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    {a.hardwareId ? (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[10px] text-nx-orange">{a.hardwareId}</span>
                        <Chip tone={a.twin?.syncState === 'SYNCED' ? 'green' : a.twin?.syncState === 'DEGRADED' ? 'amber' : 'red'} className="!px-1 !py-0">
                          {a.twin?.syncState ?? 'LOST'}
                        </Chip>
                        <button
                          className="ml-1 font-mono text-[9px] text-nx-faint hover:text-nx-red"
                          onClick={(e) => {
                            e.stopPropagation()
                            unbind(a.id)
                          }}
                        >
                          unbind
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-nx-faint">{hw ? hw.status : 'available'}</span>
                        <button
                          className="font-mono text-[9px] text-nx-cyan/80 hover:text-nx-cyan"
                          onClick={(e) => {
                            e.stopPropagation()
                            openDeploy(a.id)
                          }}
                          disabled={!!a.fault}
                        >
                          deploy →
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export function FleetStrip() {
  const agents = useNexus((s) => s.snapshot.agents)
  const selectedAgentId = useNexus((s) => s.selectedAgentId)
  const selectAgent = useNexus((s) => s.selectAgent)
  const openTask = useNexus((s) => s.selectedTaskId)
  return (
    <div className="pointer-events-auto flex items-stretch gap-1.5">
      {agents.map((a) => {
        const active = selectedAgentId === a.id
        const tone = a.fault ? 'red' : a.status === 'BLOCKED' || a.status === 'WAITING' ? 'amber' : a.hardwareId ? 'orange' : 'cyan'
        return (
          <button
            key={a.id}
            onClick={() => selectAgent(a.id)}
            className={`flex w-[126px] flex-col gap-1 rounded border px-2 py-1.5 text-left transition-colors ${
              active ? 'border-nx-cyan/60 bg-nx-cyan/[0.09]' : 'border-nx-line/80 bg-nx-base/90 hover:border-nx-line2'
            }`}
            title={a.decision?.reason ?? ''}
          >
            <div className="flex items-center gap-1.5">
              <Dot tone={tone} pulse={a.velocity > 0.05} />
              <span className="font-mono text-[10.5px] text-nx-text">{a.id}</span>
              <Chip tone={a.hardwareId ? 'orange' : 'neutral'} className="!px-1 !py-0 !text-[8px]">
                {a.hardwareId ? 'REAL' : 'SIM'}
              </Chip>
            </div>
            <div className="flex items-center gap-1">
              <span className="truncate font-mono text-[9px] uppercase tracking-wide text-nx-dim">{a.status}</span>
              <span className="ml-auto font-mono text-[9px] text-nx-faint">{a.taskId ?? '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Bar value={a.battery} tone={batteryTone(a.battery)} height={2} />
              <span className="font-mono text-[8.5px] text-nx-faint">{(a.battery * 100) | 0}%</span>
            </div>
            <div className="truncate font-mono text-[8.5px] text-nx-faint">{a.decision?.action ?? '—'}</div>
          </button>
        )
      })}
      {openTask && <span className="self-center font-mono text-[9px] text-nx-cyan/70">{openTask} selected</span>}
    </div>
  )
}
