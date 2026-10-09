import { ArrowRight, Check, CircleDashed, Rocket, ShieldAlert, X } from 'lucide-react'
import { Button, Chip, Divider, Dot, KV } from '../../components/ui'
import { useNexus } from '../../store/useNexus'

/**
 * DEPLOYMENT FLOW — the core NEXUS operation.
 *
 * Select a simulated agent → choose physical hardware → compatibility and safety
 * validation → staged bind → live binding with digital twin. The agent keeps its
 * id, task, context and planner throughout; only the execution backend changes.
 */
export function DeploymentModal() {
  const target = useNexus((s) => s.deployTarget)
  const close = useNexus((s) => s.closeDeploy)
  const snap = useNexus((s) => s.snapshot)
  const deploy = useNexus((s) => s.deploy)
  const engine = useNexus((s) => s.engine)
  const selectedHardwareId = useNexus((s) => s.selectedHardwareId)
  const selectHardware = useNexus((s) => s.selectHardware)
  if (!target) return null

  const agent = snap.agents.find((a) => a.id === target)
  if (!agent) return null
  const proc = snap.deploymentProcesses.find((p) => p.agentId === target && p.kind === 'BIND')
  const runtimeAgent = engine.agents.get(target)!
  const available = snap.hardware.filter((h) => !h.boundAgentId)
  const stageList = proc?.stages ?? []

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-nx-void/70 backdrop-blur-[2px]" onClick={close}>
      <div className="nx-rise w-[560px] overflow-hidden rounded-md border border-nx-line2 bg-nx-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-nx-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Rocket size={14} className="text-nx-cyan" />
            <span className="text-[12px] font-semibold tracking-[0.1em] text-nx-text">AGENT DEPLOYMENT</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-nx-faint">virtual agent → physical body</span>
          </div>
          <button className="text-nx-faint hover:text-nx-text" onClick={close}>
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-[1fr_1.25fr]">
          {/* selected agent ------------------------------------------------ */}
          <div className="border-r border-nx-line/80 px-4 py-3">
            <div className="nx-h">Selected agent</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-[15px] text-nx-text">{agent.id}</span>
              <Chip tone={agent.hardwareId ? 'orange' : 'cyan'}>{agent.hardwareId ? 'PHYSICAL' : 'SIMULATION'}</Chip>
            </div>
            <div className="mt-2 space-y-0">
              <KV k="Status" v={agent.status} />
              <KV k="Battery" v={`${(agent.battery * 100).toFixed(0)}%`} tone={agent.battery < 0.25 ? 'red' : undefined} />
              <KV k="Task" v={agent.taskId ?? 'idle'} />
              <KV k="Profile" v={agent.profile} />
              <KV k="Payload duty" v={`${runtimeAgent.capabilities.maxPayloadKg} kg`} />
              <KV k="Drive" v={runtimeAgent.capabilities.driveType} />
              <KV k="Velocity profile" v={`0–${runtimeAgent.capabilities.maxVelocity.toFixed(1)} m/s`} />
              <KV k="Sensors" v={`${runtimeAgent.capabilities.sensors.length} fitted`} />
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-nx-faint">
              The agent keeps its identity, task, context and planner. Only the execution backend is replaced.
            </p>
          </div>

          {/* hardware + validation ---------------------------------------- */}
          <div className="px-4 py-3">
            <div className="nx-h">Available hardware</div>
            <div className="mt-1.5 space-y-1.5">
              {available.length === 0 && <div className="text-[11px] text-nx-faint">No free hardware units</div>}
              {available.map((h) => {
                const compat = engine.binding.checkCompatibility(runtimeAgent, h)
                const reasons = compat.reasons
                const selectedHw = selectedHardwareId === h.id
                return (
                  <div
                    key={h.id}
                    onClick={() => selectHardware(h.id)}
                    className={`cursor-pointer rounded border p-2 transition-colors ${
                      selectedHw ? 'border-nx-cyan/50 bg-nx-cyan/[0.07]' : 'border-nx-line/80 bg-nx-panel2/40 hover:border-nx-line2'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Dot tone={h.status === 'ONLINE' ? 'green' : h.status === 'BUSY' ? 'amber' : 'red'} />
                      <span className="font-mono text-[11px] text-nx-text">{h.id}</span>
                      <span className="text-[10px] text-nx-faint">{h.label}</span>
                      <span className="ml-auto font-mono text-[10px] text-nx-dim">{h.status}</span>
                      <span className="font-mono text-[10px] text-nx-dim">{(h.battery * 100) | 0}%</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {compat.compatible ? (
                        <Chip tone="green">
                          <Check size={9} /> COMPATIBLE
                        </Chip>
                      ) : (
                        <Chip tone="red">
                          <X size={9} /> INCOMPATIBLE
                        </Chip>
                      )}
                      <Chip tone={h.transport === 'MOCK_GATEWAY' ? 'neutral' : 'orange'}>{h.transport.replace('_GATEWAY', '')}</Chip>
                      {!h.isRealHardware && <span className="text-[9.5px] text-nx-faint">bench device (not real hardware)</span>}
                    </div>
                    {!compat.compatible && <div className="mt-1 text-[10px] leading-snug text-nx-red/80">{reasons[0]}</div>}
                    {selectedHw && compat.compatible && (
                      <div className="mt-1.5 text-[10px] text-nx-dim">
                        {compat.checks.slice(0, 4).map((c) => (
                          <div key={c.capability} className="flex justify-between">
                            <span>{c.capability}</span>
                            <span className="font-mono text-nx-green">{c.available}</span>
                          </div>
                        ))}
                        <div className="text-nx-faint">+{compat.checks.length - 4} more checks pass</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* live stage progress */}
            {stageList.length > 0 && (
              <>
                <Divider label="Deployment sequence" />
                <div className="space-y-[3px]">
                  {stageList.map((st) => (
                    <div key={st.id} className="flex items-center gap-2">
                      {st.status === 'PASS' ? (
                        <Check size={11} className="text-nx-green" />
                      ) : st.status === 'FAIL' ? (
                        <X size={11} className="text-nx-red" />
                      ) : st.status === 'ACTIVE' ? (
                        <CircleDashed size={11} className="nx-blip text-nx-amber" />
                      ) : (
                        <CircleDashed size={11} className="text-nx-faint/50" />
                      )}
                      <span className={`font-mono text-[10px] ${st.status === 'PENDING' ? 'text-nx-faint/60' : 'text-nx-text'}`}>{st.label}</span>
                      <span className="ml-auto truncate text-right text-[9.5px] text-nx-faint" style={{ maxWidth: 190 }}>
                        {st.detail}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {proc && proc.finishedAt && !proc.ok && (
              <div className="mt-2 rounded border border-nx-red/40 bg-nx-red/10 p-2 text-[10.5px] text-nx-red">
                <ShieldAlert size={11} className="mr-1 inline" />
                {proc.message}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-nx-line px-4 py-2.5">
          <span className="text-[10.5px] text-nx-faint">
            Control is never transferred while a body is moving; the gateway re-validates every command.
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button onClick={close}>CANCEL</Button>
            <Button
              variant="real"
              disabled={!selectedHardwareId || !!proc}
              onClick={() => {
                if (selectedHardwareId) deploy(agent.id, selectedHardwareId)
              }}
            >
              BIND ROBOT <ArrowRight size={11} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
