import { Activity, Link2, Unplug, X, Zap } from 'lucide-react'
import { Bar, Button, Chip, Divider, Dot, KV, Panel } from '../../components/ui'
import { useNexus } from '../../store/useNexus'

/**
 * DIGITAL TWIN page — the physical side of NEXUS.
 * Planned state comes from the agent; actual state comes from telemetry. Both are
 * shown side by side so it is always obvious which is which.
 */
export function TwinPanel({ onClose }: { onClose: () => void }) {
  const snap = useNexus((s) => s.snapshot)
  const selectedHardwareId = useNexus((s) => s.selectedHardwareId)
  const selectHardware = useNexus((s) => s.selectHardware)
  const openDeploy = useNexus((s) => s.openDeploy)
  const unbind = useNexus((s) => s.unbind)
  const engine = useNexus((s) => s.engine)
  const pushToast = useNexus((s) => s.pushToast)

  const hw = snap.hardware.find((h) => h.id === selectedHardwareId) ?? snap.hardware.find((h) => h.boundAgentId) ?? snap.hardware[0]
  const station = snap.hardware.filter((h) => h.boundAgentId === h.id)
  const twin = hw?.boundAgentId ? snap.twins.find((t) => t.agentId === hw.boundAgentId) : null
  const agent = hw?.boundAgentId ? snap.agents.find((a) => a.id === hw.boundAgentId) : null
  const telemetry = twin?.telemetry
  const cmdLog = engine.gateway.mock.commandLog.slice(-9).reverse()

  return (
    <Panel
      className="nx-slide-in pointer-events-auto flex max-h-[calc(100vh-118px)] w-[470px] flex-col overflow-hidden"
      title={<span>DIGITAL TWIN · physical ↔ virtual</span>}
      right={
        <button className="text-nx-faint hover:text-nx-text" onClick={onClose}>
          <X size={13} />
        </button>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="nx-h">Hardware registry</span>
          <span className="ml-auto font-mono text-[9.5px] text-nx-faint">{station.length} bound</span>
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {snap.hardware.map((h) => {
            const active = hw?.id === h.id
            return (
              <button
                key={h.id}
                onClick={() => selectHardware(h.id)}
                className={`rounded border px-2 py-1.5 text-left transition-colors ${
                  active ? 'border-nx-orange/50 bg-nx-orange/[0.08]' : 'border-nx-line/80 bg-nx-panel2/40 hover:border-nx-line2'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Dot tone={h.status === 'ONLINE' ? 'green' : h.status === 'BUSY' ? 'orange' : h.status === 'ERROR' ? 'red' : 'dim'} />
                  <span className="font-mono text-[11px] text-nx-text">{h.id}</span>
                  <span className="ml-auto font-mono text-[9px] text-nx-faint">{(h.battery * 100) | 0}%</span>
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-nx-dim">{h.status}</div>
                <div className="font-mono text-[8.5px] text-nx-faint">{h.transport}</div>
                <div className="mt-1 font-mono text-[9px] text-nx-orange">{h.boundAgentId ?? '—'}</div>
              </button>
            )
          })}
        </div>

        {hw && (
          <>
            <Divider label={`${hw.id} · ${hw.label}`} />
            <div className="grid grid-cols-2 gap-x-3">
              <KV k="Status" v={hw.status} tone={hw.status === 'OFFLINE' ? 'red' : undefined} />
              <KV k="Transport" v={hw.transport} />
              <KV k="Real hardware" v={hw.isRealHardware ? 'YES' : 'NO — bench device'} tone={hw.isRealHardware ? 'orange' : 'amber'} />
              <KV k="Firmware" v={hw.firmware} />
              <KV k="Velocity" v={`${hw.velocity.toFixed(2)} m/s`} />
              <KV k="Battery" v={`${(hw.battery * 100).toFixed(1)}%`} />
              <KV k="Heartbeat" v={hw.heartbeatHz > 0 ? `${hw.heartbeatHz.toFixed(1)} Hz` : '—'} />
              <KV k="Packet loss" v={`${(hw.packetLoss * 100).toFixed(1)}%`} />
            </div>

            {twin && agent && (
              <>
                <Divider label="Twin synchronisation" />
                <div className="rounded border border-nx-line/70 bg-nx-panel2/40 p-2.5">
                  <div className="flex items-center gap-2">
                    <Link2 size={12} className="text-nx-orange" />
                    <span className="font-mono text-[11px] text-nx-text">
                      {agent.id} <span className="text-nx-faint">↕</span> {hw.id}
                    </span>
                    <Chip tone={twin.syncState === 'SYNCED' ? 'green' : twin.syncState === 'DEGRADED' ? 'amber' : 'red'} dot className="ml-auto">
                      {twin.syncState}
                    </Chip>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3">
                    <KV k="Telemetry age" v={`${(twin.telemetryAgeMs / 1000).toFixed(2)} s`} tone={twin.telemetryAgeMs > 550 ? 'amber' : 'green'} />
                    <KV k="Round-trip latency" v={`${twin.latencyMs.toFixed(0)} ms`} />
                    <KV k="Position error" v={`${twin.positionErrorM.toFixed(3)} m`} tone={twin.positionErrorM > 0.6 ? 'amber' : undefined} />
                    <KV k="Heading error" v={`${twin.headingErrorRad.toFixed(3)} rad`} />
                    <KV k="Frames synced" v={telemetry?.seq ?? 0} />
                    <KV k="Command rejects" v={snap.bindings.find((b) => b.agentId === agent.id)?.commandsRejected ?? 0} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded border border-nx-line/60 p-1.5">
                      <div className="nx-h">Planned (agent)</div>
                      <div className="font-mono text-[10px] text-nx-cyan">
                        {twin.plannedPose.x.toFixed(2)}, {twin.plannedPose.z.toFixed(2)}
                      </div>
                      <div className="font-mono text-[9px] text-nx-faint">θ {twin.plannedPose.theta.toFixed(2)} rad</div>
                    </div>
                    <div className="rounded border border-nx-line/60 p-1.5">
                      <div className="nx-h">Actual (telemetry)</div>
                      <div className="font-mono text-[10px] text-nx-orange">
                        {twin.actualPose.x.toFixed(2)}, {twin.actualPose.z.toFixed(2)}
                      </div>
                      <div className="font-mono text-[9px] text-nx-faint">θ {twin.actualPose.theta.toFixed(2)} rad</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] leading-relaxed text-nx-faint">
                    Physical telemetry is authoritative for the ACTUAL pose. The planner's intent is shown as PLANNED and is never
                    used to fake the robot's position.
                  </div>
                </div>

                {telemetry && (
                  <>
                    <Divider label="Telemetry frame" />
                    <div className="grid grid-cols-2 gap-x-3">
                      <KV k="Seq" v={telemetry.seq} />
                      <KV k="Velocity" v={`${telemetry.velocity.toFixed(2)} m/s`} />
                      <KV k="Angular" v={`${telemetry.omega.toFixed(2)} rad/s`} />
                      <KV k="Battery" v={`${(telemetry.battery * 100).toFixed(1)}%`} />
                      <KV k="Motor current" v={`${telemetry.motorCurrentA.toFixed(2)} A`} />
                      <KV k="Wheel slip est." v={`${(telemetry.wheelSlipEstimate * 100).toFixed(1)}%`} />
                      <KV k="Lidar" v={telemetry.lidarHealthy ? 'HEALTHY' : 'FAULT'} tone={telemetry.lidarHealthy ? 'green' : 'red'} />
                      <KV k="Bumper" v={telemetry.bumperTripped ? 'TRIPPED' : 'CLEAR'} tone={telemetry.bumperTripped ? 'red' : undefined} />
                      <KV k="E-stop" v={telemetry.estop ? 'ASSERTED' : 'CLEAR'} tone={telemetry.estop ? 'red' : 'green'} />
                      <KV k="Link quality" v={`${(telemetry.linkQuality * 100).toFixed(0)}%`} />
                    </div>
                    <div className="mt-1 text-[9.5px] text-nx-faint">
                      emitted t+{(telemetry.emittedAt / 1000).toFixed(2)}s · received t+{(telemetry.receivedAt / 1000).toFixed(2)}s
                    </div>
                  </>
                )}

                <Divider label="Safety layer" />
                <div className="grid grid-cols-2 gap-x-3">
                  <KV k="Armed" v={hw.safetyState.armed ? 'YES' : 'NO'} tone={hw.safetyState.armed ? 'green' : 'amber'} />
                  <KV k="E-stop" v={hw.safetyState.eStop ? 'ASSERTED' : 'CLEAR'} tone={hw.safetyState.eStop ? 'red' : 'green'} />
                  <KV k="Violations" v={hw.safetyState.violations} tone={hw.safetyState.violations ? 'amber' : undefined} />
                  <KV k="Commands rejected" v={hw.safetyState.rejectedCommands} />
                  <KV k="Velocity ceiling" v={`${hw.safetyState.velocityCeiling.toFixed(2)} m/s`} />
                  <KV k="Fleet rejections" v={engine.binding.rejections.length} />
                </div>
              </>
            )}

            {!twin && (
              <div className="mt-3 rounded border border-nx-line/70 bg-nx-panel2/30 p-2.5 text-[10.5px] leading-relaxed text-nx-dim">
                {hw.status === 'OFFLINE'
                  ? `${hw.id} is not attached to the robot gateway right now. Telemetry is unavailable, so NEXUS reports the link as offline instead of inventing state.`
                  : `${hw.id} is free. Select a simulated agent and deploy it to give this body an autonomous brain.`}
              </div>
            )}

            <Divider label="Validated command log" />
            <div className="space-y-[3px]">
              {cmdLog.map((c, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-[9.5px]">
                  <Dot tone={c.accepted ? 'green' : 'red'} />
                  <span className="text-nx-dim">{c.hardwareId}</span>
                  <span className="text-nx-text">v {c.cmd.v.toFixed(2)}</span>
                  <span className="text-nx-dim">ω {c.cmd.omega.toFixed(2)}</span>
                  <span className="text-nx-faint">{c.cmd.action}</span>
                  <span className="ml-auto text-nx-faint">{c.reason ?? (c.accepted ? 'accepted' : 'rejected')}</span>
                </div>
              ))}
              {cmdLog.length === 0 && <div className="text-[10px] text-nx-faint">No commands dispatched yet</div>}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-nx-line/80 px-3 py-2">
        {hw && !hw.boundAgentId && (
          <Button variant="primary" onClick={() => selectHardware(hw.id)}>
            <Zap size={11} /> SELECT FOR DEPLOYMENT
          </Button>
        )}
        {hw?.boundAgentId && (
          <>
            <Button variant="real" onClick={() => unbind(hw.boundAgentId!)}>
              <Unplug size={11} /> SAFE UNBIND
            </Button>
            <Button onClick={() => openDeploy(hw.boundAgentId!)}>VIEW AGENT</Button>
          </>
        )}
        <Button
          onClick={() => {
            if (!hw) return
            engine.physicalDropout(hw.id, 25)
            pushToast(`${hw.id} telemetry dropped for 25 s`, 'CRITICAL')
          }}
          variant="danger"
        >
          <Activity size={11} /> DROP LINK
        </Button>
        <Button
          onClick={() => {
            if (!hw) return
            engine.resumeHardware(hw.id)
            pushToast(`${hw.id} link restored`, 'SUCCESS')
          }}
        >
          RESTORE LINK
        </Button>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[9px] text-nx-faint">sync lat</span>
          <span className="font-mono text-[10px] text-nx-orange">
            {engine.binding.syncLatencies.length
              ? `${(engine.binding.syncLatencies.slice(-20).reduce((s, x) => s + x, 0) / Math.min(20, engine.binding.syncLatencies.length)).toFixed(0)} ms`
              : '—'}
          </span>
          <Bar value={twin?.syncState === 'SYNCED' ? 1 : twin ? 0.4 : 0} tone={twin?.syncState === 'SYNCED' ? 'green' : 'amber'} className="w-14" />
        </span>
      </div>
    </Panel>
  )
}
