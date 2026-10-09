import { AlertTriangle, BatteryCharging, Boxes, Crosshair, Gauge, Radio, Rocket, ShieldAlert, Wrench, X } from 'lucide-react'
import { Bar, Button, Chip, Divider, Dot, KV, Panel } from '../../components/ui'
import { useNexus, type AgentView } from '../../store/useNexus'

function batteryTone(b: number) {
  return b < 0.15 ? 'red' : b < 0.3 ? 'amber' : b < 0.6 ? 'cyan' : 'green'
}

const statusTone = (s: string) =>
  s === 'FAILED' || s === 'E_STOP' ? 'red' : s === 'BLOCKED' || s === 'WAITING' ? 'amber' : s === 'REPLANNING' ? 'purple' : s === 'CHARGING' ? 'green' : 'cyan'

export function RobotPanel({ agent }: { agent: AgentView }) {
  const selectAgent = useNexus((s) => s.selectAgent)
  const openDeploy = useNexus((s) => s.openDeploy)
  const unbind = useNexus((s) => s.unbind)
  const injectFault = useNexus((s) => s.injectFault)
  const recover = useNexus((s) => s.recover)
  const eStop = useNexus((s) => s.eStop)
  const setFollow = useNexus((s) => s.setFollow)
  const selectTask = useNexus((s) => s.selectTask)
  const bindings = useNexus((s) => s.snapshot.bindings)
  const hardware = useNexus((s) => s.snapshot.hardware)
  const ctx = agent.context
  const binding = bindings.find((b) => b.agentId === agent.id)
  const hw = agent.hardwareId ? hardware.find((h) => h.id === agent.hardwareId) : null
  const physical = agent.executionMode === 'PHYSICAL'

  return (
    <Panel
      className="nx-slide-in pointer-events-auto flex max-h-[calc(100vh-118px)] w-[368px] flex-col overflow-hidden"
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-nx-text">{agent.id}</span>
          <Chip tone={physical ? 'orange' : 'cyan'}>{physical ? 'PHYSICAL' : 'SIMULATED'}</Chip>
          {agent.fault && <Chip tone="red">FAULT</Chip>}
        </span>
      }
      right={
        <div className="flex items-center gap-1">
          <button className="text-nx-faint hover:text-nx-text" title="Follow with camera" onClick={() => setFollow(agent.id)}>
            <Crosshair size={13} />
          </button>
          <button className="text-nx-faint hover:text-nx-text" title="Close" onClick={() => selectAgent(null)}>
            <X size={13} />
          </button>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {/* live decision — the first thing an observer should read */}
        <div className="rounded border border-nx-line/80 bg-nx-panel2/60 p-2.5">
          <div className="flex items-center justify-between">
            <span className="nx-h">Current decision</span>
            <span className="font-mono text-[10px] text-nx-faint">t+{agent.decision ? agent.decision.at.toFixed(1) : '—'}s</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Chip tone={statusTone(agent.status) as never} dot>
              {agent.status}
            </Chip>
            <span className="font-mono text-[11px] text-nx-text">{agent.decision?.action ?? '—'}</span>
            <span className="ml-auto font-mono text-[10px] text-nx-faint">
              conf {(agent.decision?.confidence ?? 0).toFixed(2)}
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-nx-dim">{agent.decision?.reason ?? 'No decision recorded yet'}</p>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <div className="nx-h">Velocity</div>
            <div className="font-mono text-[14px] tabular-nums text-nx-text">{agent.velocity.toFixed(2)}</div>
            <div className="text-[10px] text-nx-faint">m/s</div>
          </div>
          <div>
            <div className="nx-h">Battery</div>
            <div className={`font-mono text-[14px] tabular-nums ${batteryTone(agent.battery) === 'red' ? 'text-nx-red' : batteryTone(agent.battery) === 'amber' ? 'text-nx-amber' : 'text-nx-text'}`}>
              {(agent.battery * 100).toFixed(0)}%
            </div>
            <Bar value={agent.battery} tone={batteryTone(agent.battery)} className="mt-1" />
          </div>
          <div>
            <div className="nx-h">Payload</div>
            <div className="font-mono text-[14px] tabular-nums text-nx-text">{agent.payloadKg.toFixed(1)}</div>
            <div className="text-[10px] text-nx-faint">{agent.carrying ?? 'empty'}</div>
          </div>
        </div>

        <Divider label="Task" />
        {agent.taskId ? (
          <div className="space-y-1">
            <button className="flex w-full items-center justify-between" onClick={() => selectTask(agent.taskId)}>
              <span className="font-mono text-[11px] text-nx-cyan">{agent.taskId}</span>
              <span className="font-mono text-[10px] text-nx-faint">view →</span>
            </button>
            <div className="text-[11px] text-nx-dim">{agent.taskLabel}</div>
            {ctx?.task && (
              <div className="nx-row">
                <span className="text-[11px] text-nx-dim">Step {ctx.task.step + 1}/{ctx.task.total}</span>
                <span className="font-mono text-[11px] text-nx-text">
                  {ctx.task.kind} {ctx.task.target}
                </span>
              </div>
            )}
            {ctx?.route && (
              <>
                <KV k="Route v{version}" v={`v${ctx.route.version} · ${ctx.route.origin.replace('REPLAN_', '')}`} />
                <KV k="Remaining" v={`${ctx.route.remainingM.toFixed(1)} m`} />
                {ctx.route.blocked && <KV k="Route blocked by" v={ctx.route.blockedBy ?? 'obstacle'} tone="red" />}
              </>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-nx-faint">No task — bidding on the open market when work appears</div>
        )}

        <Divider label="Individual context" />
        <div className="rounded border border-nx-line/70 bg-nx-panel2/40 p-2">
          <div className="grid grid-cols-2 gap-x-3">
            <KV k="Sector" v={ctx?.zoneId ?? 'aisle'} />
            <KV k="Profile" v={ctx?.profile ?? '—'} />
            <KV k="Caution" v={(ctx?.caution ?? 0).toFixed(2)} />
            <KV k="Speed bias" v={(ctx?.speedBias ?? 0).toFixed(2)} />
            <KV k="Charge at" v={`${((ctx?.chargeThreshold ?? 0) * 100).toFixed(0)}%`} />
            <KV k="Congestion" v={`${((ctx?.congestion ?? 0) * 100).toFixed(0)}%`} />
            <KV k="Fwd clearance" v={`${(ctx?.forwardClearance ?? 0).toFixed(2)} m`} tone={(ctx?.forwardClearance ?? 9) < 1 ? 'amber' : undefined} />
            <KV k="Min clearance" v={`${(ctx?.minClearance ?? 0).toFixed(2)} m`} />
          </div>
        </div>

        <div className="mt-2">
          <div className="nx-h mb-1">Local perception</div>
          {ctx?.peers.length ? (
            <div className="space-y-1">
              {ctx.peers.slice(0, 4).map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded border border-nx-line/60 bg-nx-panel2/30 px-2 py-1">
                  <Dot tone={p.ttc !== null && p.ttc < 3 ? 'red' : 'amber'} pulse={p.ttc !== null && p.ttc < 3} />
                  <span className="font-mono text-[10.5px] text-nx-text">{p.id}</span>
                  <Chip tone={p.mode === 'PHYSICAL' ? 'orange' : 'neutral'} className="!px-1 !py-0">
                    {p.mode === 'PHYSICAL' ? 'REAL' : p.mode === 'MOCK' ? 'MOCK' : 'SIM'}
                  </Chip>
                  <span className="ml-auto font-mono text-[10px] text-nx-dim">{p.distance.toFixed(1)} m</span>
                  <span className={`font-mono text-[10px] ${p.ttc !== null && p.ttc < 3 ? 'text-nx-red' : 'text-nx-faint'}`}>
                    {p.ttc !== null ? `TTC ${p.ttc.toFixed(1)}s` : 'clear'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-nx-faint">No peers inside the 8 m perception radius</div>
          )}
          {ctx?.obstacles.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {ctx.obstacles.slice(0, 3).map((o) => (
                <Chip key={o.id} tone={o.onPath ? 'red' : 'neutral'}>
                  {o.id} {o.distance.toFixed(1)}m{o.onPath ? ' ON PATH' : ''}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>

        <Divider label="Execution backend" />
        <div className="rounded border border-nx-line/70 bg-nx-panel2/40 p-2">
          <KV k="Mode" v={physical ? 'PHYSICAL' : 'SIMULATION'} tone={physical ? 'orange' : 'cyan'} />
          <KV k="Backend" v={physical ? `PhysicalBackend → ${agent.hardwareId}` : 'SimulationBackend'} />
          {hw && (
            <>
              <KV k="Transport" v={hw.transport} />
              <KV k="Hardware" v={`${hw.id} · ${hw.status}`} />
              <KV k="Firmware" v={hw.firmware} />
              {binding && <KV k="Commands dispatched" v={binding.commandsDispatched} />}
              {binding && binding.commandsRejected > 0 && <KV k="Rejected by safety" v={binding.commandsRejected} tone="amber" />}
            </>
          )}
        </div>

        {agent.twin && (
          <>
            <Divider label="Digital twin" />
            <div className="rounded border border-nx-line/70 bg-nx-panel2/40 p-2">
              <div className="flex items-center justify-between">
                <span className="nx-h">Sync state</span>
                <Chip tone={agent.twin.syncState === 'SYNCED' ? 'green' : agent.twin.syncState === 'DEGRADED' ? 'amber' : 'red'} dot>
                  {agent.twin.syncState}
                </Chip>
              </div>
              <KV k="Telemetry age" v={`${(agent.twin.telemetryAgeMs / 1000).toFixed(2)} s`} tone={agent.twin.telemetryAgeMs > 550 ? 'amber' : undefined} />
              <KV k="Latency" v={`${agent.twin.latencyMs.toFixed(0)} ms`} />
              <KV k="Planned vs actual" v={`${agent.twin.positionErrorM.toFixed(3)} m`} tone={agent.twin.positionErrorM > 0.6 ? 'amber' : undefined} />
              <KV k="Packet loss" v={`${(agent.twin.packetLoss * 100).toFixed(1)}%`} />
            </div>
          </>
        )}

        <Divider label="Agent memory" />
        <div className="grid grid-cols-2 gap-x-3">
          <KV k="Tasks completed" v={ctx?.completedTasks ?? 0} />
          <KV k="Replans" v={ctx?.replans ?? 0} />
          <KV k="Yields" v={ctx?.yields ?? 0} />
          <KV k="Held / blocked" v={`${(ctx?.heldSeconds ?? 0).toFixed(0)} s`} />
          <KV k="Mesh peers" v={ctx?.peersInRange.length ?? 0} />
          <KV k="Mesh latency" v={`${(ctx?.commsLatency ?? 0).toFixed(0)} ms`} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-nx-line/80 px-3 py-2">
        {!physical && (
          <Button variant="primary" onClick={() => openDeploy(agent.id)} disabled={!!agent.fault}>
            <Rocket size={12} /> DEPLOY TO PHYSICAL
          </Button>
        )}
        {physical && (
          <Button variant="real" onClick={() => unbind(agent.id)}>
            <ShieldAlert size={12} /> SAFE UNBIND
          </Button>
        )}
        <Button onClick={() => eStop(agent.id, !agent.status.includes('E_STOP'))} variant={agent.status === 'E_STOP' ? 'default' : 'danger'}>
          <AlertTriangle size={12} /> {agent.status === 'E_STOP' ? 'RELEASE E-STOP' : 'E-STOP'}
        </Button>
        {agent.fault ? (
          <Button onClick={() => recover(agent.id)}>
            <Wrench size={12} /> RECOVER
          </Button>
        ) : (
          <Button onClick={() => injectFault(agent.id)} title="Inject a drive controller fault">
            <BatteryCharging size={12} /> INJECT FAULT
          </Button>
        )}
        <Button onClick={() => setFollow(agent.id)}>
          <Gauge size={12} /> FOLLOW
        </Button>
        <span className="ml-auto flex items-center gap-1 font-mono text-[9px] text-nx-faint">
          <Radio size={9} /> {ctx?.peersInRange.length ? 'MESH LINKED' : 'MESH IDLE'}
        </span>
      </div>
    </Panel>
  )
}

export function RobotMiniCard({ agent }: { agent: AgentView }) {
  const selectAgent = useNexus((s) => s.selectAgent)
  const selected = useNexus((s) => s.selectedAgentId === agent.id)
  return (
    <button
      onClick={() => selectAgent(agent.id)}
      className={`flex min-w-[132px] flex-col gap-1 rounded border px-2 py-1.5 text-left transition-colors ${
        selected ? 'border-nx-cyan/50 bg-nx-cyan/10' : 'border-nx-line/80 bg-nx-panel/90 hover:border-nx-line2'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Dot tone={agent.fault ? 'red' : agent.status === 'WAITING' || agent.status === 'BLOCKED' ? 'amber' : agent.hardwareId ? 'orange' : 'cyan'} pulse={agent.velocity > 0.05} />
        <span className="font-mono text-[11px] text-nx-text">{agent.id}</span>
        <span className="ml-auto font-mono text-[9px] text-nx-faint">{agent.hardwareId ? 'REAL' : 'SIM'}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-[9.5px] uppercase tracking-wide text-nx-dim">{agent.status}</span>
        <span className="ml-auto font-mono text-[9.5px] text-nx-faint">{agent.taskId ?? '—'}</span>
      </div>
      <Bar value={agent.battery} tone={batteryTone(agent.battery)} height={3} />
    </button>
  )
}

export { Boxes }
