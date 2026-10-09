/**
 * DIGITAL TWIN (§33 + §47A)
 *
 * Physical hardware registry, twin synchronisation telemetry, the staged
 * deployment wizard and the safety/command ledger. MOCK hardware is labelled
 * MOCK everywhere — never presented as a real robot.
 */

import clsx from 'clsx';
import {
  AlertTriangle,
  Cpu,
  HardDrive,
  Link2,
  Radio,
  ShieldAlert,
  Unlink,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { runtime } from '@/simulation/runtime';
import { checkCompatibility } from '@/simulation/robots/hardware';
import { useNexus } from '@/store/useNexus';
import { BindingDialog } from '@/components/BindingDialog';
import { Bar, Chip, Dot, Empty, KV, Panel, Sparkline, Stat, type Tone } from '@/components/ui';

const HW_TONE: Record<string, Tone> = {
  ONLINE: 'ok',
  BUSY: 'nav',
  OFFLINE: 'danger',
  FAULT: 'danger',
  ESTOP: 'danger',
};

const SYNC_TONE: Record<string, Tone> = {
  SYNCED: 'ok',
  DRIFTING: 'warn',
  STALE: 'warn',
  LOST: 'danger',
  OFFLINE: 'danger',
};

export function DigitalTwin() {
  const snap = useNexus((s) => s.snap);
  const selectRobot = useNexus((s) => s.selectRobot);
  const openBinding = useNexus((s) => s.openBinding);
  const notify = useNexus((s) => s.notify);

  const bound = snap.robots.filter((r) => r.executionMode === 'PHYSICAL');
  const virtual = snap.robots.filter((r) => r.executionMode === 'SIMULATION');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-void p-3">
      {/* ── banner ──────────────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center gap-3 rounded-md border border-warn/30 bg-warn/[0.06] px-3 py-2">
        <AlertTriangle size={14} className="shrink-0 text-warn" />
        <div className="text-[11px] leading-snug text-txt2">
          <b className="text-warn">HARDWARE CLASS NOTICE.</b> Units connected through{' '}
          <span className="mono">MOCK_BRIDGE</span> are simulated hardware interfaces that obey the
          exact same protocol, rate limits and safety envelope as a ROS 2 bridge. They are labelled{' '}
          <b>MOCK</b> at every layer. Swapping one for a real{' '}
          <span className="mono">ROS2_WEBSOCKET</span> transport changes nothing else in the system.
        </div>
      </div>

      {/* ── counts ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-6 gap-3">
        <div className="panel p-3">
          <Stat label="VIRTUAL AGENTS" value={`${virtual.length}`} tone="nav" />
        </div>
        <div className="panel p-3">
          <Stat label="PHYSICAL AGENTS" value={`${bound.length}`} tone="ok" />
        </div>
        <div className="panel p-3">
          <Stat label="HW UNITS" value={`${snap.hardware.length}`} />
        </div>
        <div className="panel p-3">
          <Stat label="FREE UNITS" value={`${snap.hardware.filter((h) => !h.boundTo).length}`} tone="ok" />
        </div>
        <div className="panel p-3">
          <Stat label="SAFE REJECTS" value={`${snap.robots.reduce((a, r) => a + r.binding.rejectedCommands, 0)}`} tone="warn" />
        </div>
        <div className="panel p-3">
          <Stat label="TC PACKETS" value={`${snap.robots.reduce((a, r) => a + r.twin.packetsReceived, 0)}`} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* ── hardware registry ────────────────────────────────────────────── */}
        <Panel
          title={
            <span className="flex items-center gap-2">
              <HardDrive size={12} className="text-txt3" />
              HARDWARE REGISTRY
            </span>
          }
          dense
        >
          {snap.hardware.map((h) => {
            const owner = bound.find((r) => r.hardwareId === h.id) ?? null;
            return (
              <div key={h.id} className="border-b border-line/50 p-3 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="mono text-[14px] font-semibold text-txt">{h.id}</span>
                  <span className="text-2xs text-txt2">{h.name}</span>
                  <Chip tone={HW_TONE[h.status]}>{h.status}</Chip>
                  {h.mock && <Chip tone="warn">MOCK</Chip>}
                  {h.boundTo ? (
                    <button
                      className="mono text-[11px] font-semibold text-ok hover:underline"
                      onClick={() => selectRobot(h.boundTo!)}
                    >
                      ← {h.boundTo}
                    </button>
                  ) : (
                    <Chip tone="ok">FREE</Chip>
                  )}
                  <span className="mono ml-auto text-3xs text-txt3">{h.transport}</span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-x-4">
                  <KV k="MODEL" v={h.model} />
                  <KV k="FIRMWARE" v={h.firmware} />
                  <KV k="MAX V" v={`${h.capabilities.maxVelocity.toFixed(2)} m/s`} />
                  <KV k="PAYLOAD" v={`${h.capabilities.payloadKg} kg`} />
                  <KV k="LIDAR" v={h.capabilities.lidar ? 'AVAILABLE' : 'NOT FITTED'} tone={h.capabilities.lidar ? 'ok' : 'warn'} />
                  <KV k="ENDPOINT" v={h.endpoint ?? '—'} />
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-3xs uppercase tracking-[0.1em] text-txt3">BATTERY</span>
                  <div className="w-32"><Bar value={h.battery} tone={h.battery > 30 ? 'ok' : 'warn'} /></div>
                  <span className="mono text-3xs text-txt2">{h.battery.toFixed(0)}%</span>
                  <span className="mono ml-auto text-3xs text-txt3">
                    POSE {h.pose.x.toFixed(1)}, {h.pose.y.toFixed(1)}
                  </span>
                </div>

                {owner && (
                  <div className="mt-2 rounded border border-ok/25 bg-ok/[0.06] p-2">
                    <div className="flex items-center gap-2">
                      <Radio size={10} className="text-ok" />
                      <span className="text-2xs font-semibold uppercase tracking-[0.1em] text-ok">
                        TWIN {owner.twin.sync}
                      </span>
                      <span className="mono ml-auto text-3xs text-txt3">
                        {(owner.twin.updateHz).toFixed(0)} Hz
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-4">
                      <KV k="POSITION ERROR" v={`${owner.twin.positionError.toFixed(3)} m`} tone={owner.twin.positionError > 0.2 ? 'warn' : 'ok'} />
                      <KV k="TELEMETRY AGE" v={`${owner.twin.telemetryAge.toFixed(3)} s`} tone={owner.twin.telemetryAge > 0.5 ? 'warn' : 'ok'} />
                      <KV k="PACKETS RX" v={`${owner.twin.packetsReceived}`} />
                      <KV k="PACKETS DROPPED" v={`${owner.twin.packetsDropped}`} tone={owner.twin.packetsDropped > 0 ? 'warn' : 'ok'} />
                      <KV k="LINK LATENCY" v={`${owner.twin.latencyMs.toFixed(0)} ms`} />
                      <KV k="HW BATTERY" v={`${owner.twin.batteryReported.toFixed(1)} %`} />
                    </div>
                    <div className="mt-1.5">
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="label">VIRTUAL ↔ PHYSICAL ERROR</span>
                        <span className="mono ml-auto text-3xs text-txt3">
                          MAX {Math.max(...(owner.twin.errorHistory.length ? owner.twin.errorHistory : [0])).toFixed(3)} m
                        </span>
                      </div>
                      <Sparkline data={owner.twin.errorHistory} color="#38BDF8" height={30} width={330} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-3xs text-txt3">
                        {owner.taskId ? `CARRYING TASK ${owner.taskId}` : 'IDLE'} · {owner.completedTasks} COMPLETED
                      </span>
                      <button
                        className="btn btn-danger ml-auto"
                        disabled={owner.binding.stage !== 'IDLE'}
                        onClick={() => {
                          runtime.engine.requestUnbind(owner.id);
                          notify(`RELEASING ${h.id} FROM ${owner.id} · SAFE STATE FIRST`, 'WARNING');
                        }}
                      >
                        <Unlink size={11} />
                        UNBIND
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Panel>

        {/* ── agent → hardware matrix ──────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Cpu size={12} className="text-txt3" />
                AGENT → HARDWARE ELIGIBILITY
              </span>
            }
            dense
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead>
                  <tr className="bg-abyss/70">
                    <th className="th text-left">AGENT</th>
                    {snap.hardware.map((h) => (
                      <th key={h.id} className="th text-center">{h.id}</th>
                    ))}
                    <th className="th text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.robots.map((r) => (
                    <tr key={r.id} className="border-t border-line/50">
                      <td className="px-2 py-1.5">
                        <span className="mono text-[11px] font-semibold text-txt">{r.id}</span>
                        {r.executionMode === 'PHYSICAL' && <span className="ml-1 text-3xs text-ok">●</span>}
                      </td>
                      {snap.hardware.map((h) => (
                        <td key={h.id} className="px-2 py-1.5 text-center">
                          <EligibilityCell robotId={r.id} hardwareId={h.id} />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right">
                        {r.executionMode === 'PHYSICAL' ? (
                          <span className="mono text-3xs text-ok">{r.hardwareId}</span>
                        ) : r.binding.stage !== 'IDLE' ? (
                          <span className="mono text-3xs text-analysis">{r.binding.stage}</span>
                        ) : (
                          <button className="btn px-1.5 py-0.5 text-3xs" onClick={() => openBinding(r.id)}>
                            <Link2 size={9} />
                            DEPLOY
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-line px-3 py-2 text-3xs leading-relaxed text-txt3">
              Eligibility is computed by <span className="mono">checkCompatibility(agent, unit)</span>{' '}
              across drive type, velocity, acceleration, turn rate, payload, perception, navigation,
              actuators and required telemetry streams. No agent is special-cased.
            </div>
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <ShieldAlert size={12} className="text-txt3" />
                SAFETY + COMMAND LEDGER
              </span>
            }
            className="min-h-0 flex-1"
            dense
          >
            <div className="h-full overflow-auto">
              {snap.robots.filter((r) => r.binding.rejectedCommands > 0 || r.executionMode === 'PHYSICAL').length === 0 && (
                <Empty>
                  NO PHYSICAL COMMANDS ISSUED YET
                  <br />
                  <span className="text-3xs">deploy an agent to see the safety layer work</span>
                </Empty>
              )}
              {snap.robots
                .filter((r) => r.executionMode === 'PHYSICAL' || r.binding.rejectedCommands > 0)
                .map((r) => (
                  <div key={r.id} className="border-b border-line/50 px-3 py-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[12px] font-semibold text-txt">{r.id}</span>
                      <Chip tone={r.executionMode === 'PHYSICAL' ? 'ok' : 'steel'}>
                        {r.executionMode === 'PHYSICAL' ? `${r.hardwareId}` : 'SIMULATED'}
                      </Chip>
                      <span className="ml-auto flex items-center gap-1">
                        {r.connected ? <Wifi size={10} className="text-ok" /> : <WifiOff size={10} className="text-danger" />}
                        <span className="mono text-3xs text-txt3">{r.latencyMs.toFixed(0)}ms</span>
                      </span>
                    </div>
                    <KV k="BINDING STAGE" v={r.binding.stage} tone={r.binding.stage === 'ACTIVE' || r.binding.stage === 'IDLE' ? 'ok' : 'analysis'} />
                    <KV k="COMMANDS REJECTED" v={`${r.binding.rejectedCommands}`} tone={r.binding.rejectedCommands ? 'warn' : 'ok'} />
                    {r.binding.lastRejection && <KV k="LAST REJECTION" v={r.binding.lastRejection} tone="warn" />}
                    <KV k="E-STOP" v={r.estop ? 'ENGAGED' : 'CLEAR'} tone={r.estop ? 'danger' : 'ok'} />
                  </div>
                ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── protocol note ──────────────────────────────────────────────────── */}
      <div className={clsx('mt-3 rounded border border-line2 bg-abyss/40 px-3 py-2')}>
        <div className="label mb-1">INTEGRATION CHAIN</div>
        <div className="flex items-center gap-2 text-[11px] text-txt2">
          <Chip tone="steel">ROS 2 / GAZEBO / REAL AMR</Chip>
          <span className="text-txt3">→</span>
          <Chip tone="steel">BRIDGE · TELEMETRY + CMD_VEL</Chip>
          <span className="text-txt3">→</span>
          <Chip tone="nav">WEBSOCKET</Chip>
          <span className="text-txt3">→</span>
          <Chip tone="nav">STATE BRIDGE (ZUSTAND)</Chip>
          <span className="text-txt3">→</span>
          <Chip tone="nav">REACT + R3F</Chip>
          <span className="ml-2 text-3xs text-txt3">
            the frontend never speaks ROS 2 directly — it only consumes the state bridge
          </span>
        </div>
      </div>

      <BindingDialog />
    </div>
  );
}

function EligibilityCell({ robotId, hardwareId }: { robotId: string; hardwareId: string }) {
  const snap = useNexus((s) => s.snap);
  const robot = snap.robots.find((r) => r.id === robotId);
  const unit = snap.hardware.find((h) => h.id === hardwareId);
  if (!robot || !unit) return <span className="text-txt3">—</span>;
  if (robot.executionMode === 'PHYSICAL' && robot.hardwareId === hardwareId) {
    return <span className="mono text-[10px] font-bold text-ok">BOUND</span>;
  }
  const rep = checkCompatibility(robotId, robot.capabilities, unit);
  return rep.compatible ? (
    <span className={clsx('mono text-[10px]', unit.boundTo ? 'text-warn' : 'text-ok')}>
      {unit.boundTo ? 'BUSY' : 'ELIGIBLE'}
    </span>
  ) : (
    <span className="mono text-[10px] text-danger" title={rep.reason}>
      NO
    </span>
  );
}

export { Dot };
