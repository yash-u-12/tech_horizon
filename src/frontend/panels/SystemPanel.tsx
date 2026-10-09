import { Cpu, Globe, Plug, Radio, X } from 'lucide-react'
import { Button, Chip, Dot, KV, Panel } from '../../components/ui'
import { useNexus } from '../../store/useNexus'
import type { SystemNode } from '../../types'

const toneOf = (s: string) => (s === 'ONLINE' ? 'green' : s === 'DEGRADED' ? 'amber' : s === 'NOT_CONNECTED' ? 'neutral' : 'red')

export function buildNodes(
  snap: ReturnType<typeof useNexus.getState>['snapshot'],
  engine: ReturnType<typeof useNexus.getState>['engine'],
): SystemNode[] {
  const nodes: SystemNode[] = [
    { id: 'sim', label: 'KUBERA Simulation Engine', kind: 'SIM', status: snap.running ? 'ONLINE' : 'DEGRADED', detail: `${snap.fps} fps render · ${snap.speed}× sim rate · ${snap.simTimeS.toFixed(0)} s elapsed`, latencyMs: null, heartbeatHz: 20, packetLoss: null },
    ...snap.agents.map((a) => ({
      id: a.id,
      label: `${a.id} · ${a.profile}`,
      kind: 'AGENT' as const,
      status: (a.fault ? 'DEGRADED' : a.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE') as SystemNode['status'],
      detail: `${a.executionMode === 'PHYSICAL' ? `physical via ${a.hardwareId}` : 'simulated body'} · task ${a.taskId ?? '—'}`,
      latencyMs: a.twin?.latencyMs ?? null,
      heartbeatHz: a.twin ? 20 : null,
      packetLoss: a.twin?.packetLoss ?? null,
    })),
    { id: 'mesh', label: 'Peer Intent Mesh', kind: 'BUS', status: snap.meshTraffic.dropped > 5 ? 'DEGRADED' : 'ONLINE', detail: `${snap.meshTraffic.sent} sent · ${snap.meshTraffic.delivered} delivered · ${snap.meshTraffic.dropped} dropped`, latencyMs: 22, heartbeatHz: 2, packetLoss: snap.meshTraffic.sent ? snap.meshTraffic.dropped / snap.meshTraffic.sent : 0 },
    { id: 'gateway', label: 'Hardware Binding Manager', kind: 'BACKEND', status: 'ONLINE', detail: `${snap.hardware.length} hardware units · ${snap.bindings.length} binding(s) · ${engine.binding.rejections.length} refusal(s)`, latencyMs: null, heartbeatHz: null, packetLoss: null },
    {
      id: 'bridge',
      label: 'KUBERA Robot Gateway (FastAPI)',
      kind: 'GATEWAY',
      status: snap.bridge.connected ? 'ONLINE' : 'NOT_CONNECTED',
      detail: snap.bridge.connected ? snap.bridge.detail : 'not connected — physical commands are held in-process',
      latencyMs: engine.bridgeStatus.latencyMs || null,
      heartbeatHz: snap.bridge.connected ? 1 : null,
      packetLoss: engine.bridgeStatus.packetLoss || null,
    },
    {
      id: 'ros2',
      label: 'ROS 2 Bridge',
      kind: 'ROS2',
      status: snap.hardware.some((h) => h.transport === 'WS_GATEWAY' && h.status !== 'OFFLINE') ? 'ONLINE' : 'NOT_CONNECTED',
      detail: snap.hardware.some((h) => h.transport === 'WS_GATEWAY' && h.status !== 'OFFLINE')
        ? 'device node attached through the gateway'
        : 'no ROS 2 device attached',
      latencyMs: null,
      heartbeatHz: null,
      packetLoss: null,
    },
    ...snap.hardware.map((h) => ({
      id: h.id,
      label: `${h.id} · ${h.label}`,
      kind: 'HARDWARE' as const,
      status: (h.status === 'ONLINE' ? 'ONLINE' : h.status === 'BUSY' ? 'ONLINE' : h.status === 'ERROR' ? 'DEGRADED' : 'OFFLINE') as SystemNode['status'],
      detail: `${h.transport} · ${h.isRealHardware ? 'real hardware' : 'bench device (not real)'} · ${h.boundAgentId ? `hosting ${h.boundAgentId}` : 'free'}`,
      latencyMs: h.latencyMs || null,
      heartbeatHz: h.heartbeatHz || null,
      packetLoss: h.packetLoss,
    })),
  ]
  return nodes
}

export function SystemPanel({ onClose }: { onClose: () => void }) {
  const snap = useNexus((s) => s.snapshot)
  const engine = useNexus((s) => s.engine)
  const connectBridge = useNexus((s) => s.connectBridge)
  const nodes = buildNodes(snap, engine)

  return (
    <Panel
      className="nx-slide-in pointer-events-auto flex max-h-[calc(100vh-118px)] w-[470px] flex-col overflow-hidden"
      title={<span>SYSTEM · runtime topology</span>}
      right={
        <button className="text-nx-faint hover:text-nx-text" onClick={onClose}>
          <X size={13} />
        </button>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <div className="space-y-1">
          {nodes.map((n) => (
            <div key={n.id} className="flex items-center gap-2 rounded border border-nx-line/70 bg-nx-panel2/30 px-2 py-1.5">
              <Dot tone={toneOf(n.status)} pulse={n.status === 'DEGRADED'} />
              <span className="text-[11px] text-nx-text">{n.label}</span>
              <Chip tone={toneOf(n.status) as never} className="ml-1 !px-1 !py-0 !text-[8.5px]">
                {n.status.replace('_', ' ')}
              </Chip>
              <span className="ml-auto max-w-[200px] truncate text-right text-[10px] text-nx-faint">{n.detail}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-3">
          <KV k="Decision latency" v={`${snap.metrics.avgDecisionLatencyMs.toFixed(1)} ms`} />
          <KV k="Link latency" v={`${snap.metrics.linkLatencyMs.toFixed(0)} ms`} />
          <KV k="Agents simulated" v={snap.agents.filter((a) => !a.hardwareId).length} />
          <KV k="Agents on hardware" v={snap.bindings.length} />
          <KV k="Deployments recorded" v={engine.binding.deploymentTimes.length} />
          <KV k="Safety refusals" v={engine.binding.rejections.length} />
        </div>

        <div className="mt-3 rounded border border-nx-line/70 bg-nx-panel2/30 p-2.5">
          <div className="flex items-center gap-2">
            <Globe size={12} className="text-nx-cyan" />
            <span className="nx-h">Robot gateway boundary</span>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-nx-dim">
            The browser never actuates hardware. Agent commands travel: agent → safety envelope → gateway transport → FastAPI robot
            gateway → device/ROS 2 → body. Telemetry returns along the same path and updates the digital twin.
          </p>
          <div className="mt-2 space-y-[3px] font-mono text-[9.5px]">
            <div className="flex justify-between">
              <span className="text-nx-faint">WS commands</span>
              <span className="text-nx-dim">/ws/robot</span>
            </div>
            <div className="flex justify-between">
              <span className="text-nx-faint">REST</span>
              <span className="text-nx-dim">/api/hardware · /api/bind · /api/tasks · /api/experiments</span>
            </div>
            <div className="flex justify-between">
              <span className="text-nx-faint">run backend</span>
              <span className="text-nx-dim">uvicorn nexus_gateway:app --port 8000</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-nx-line/80 px-3 py-2">
        <Button variant="primary" onClick={connectBridge}>
          <Plug size={11} /> CONNECT ROBOT GATEWAY
        </Button>
        <span className="flex items-center gap-1 font-mono text-[9.5px] text-nx-faint">
          <Radio size={10} /> {snap.bridge.connected ? 'streaming telemetry' : 'in-process transport active'}
        </span>
        <span className="ml-auto flex items-center gap-1 font-mono text-[9.5px] text-nx-faint">
          <Cpu size={10} /> {snap.objects.filter((o) => o.kind === 'RACK').length} racks · {snap.packages.length} packages
        </span>
      </div>
    </Panel>
  )
}
