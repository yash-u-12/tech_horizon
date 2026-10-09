import clsx from 'clsx';
import {
  Activity,
  BatteryCharging,
  Brain,
  Crosshair,
  Eye,
  Link2,
  MapPin,
  Navigation,
  Package as PackageIcon,
  Radio,
  Route,
  ShieldAlert,
  Target,
  Unlink,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { runtime } from '@/simulation/runtime';
import { useNexus } from '@/store/useNexus';
import { Bar, Chip, Divider, Dot, KV, Stat, type Tone } from './ui';
import type { RobotState } from '@/simulation/types';

const STATUS_TONE: Record<string, Tone> = {
  IDLE: 'steel',
  MOVING: 'nav',
  WAITING: 'warn',
  PICKING: 'nav',
  DROPPING: 'nav',
  CHARGING: 'ok',
  REROUTING: 'analysis',
  BLOCKED: 'danger',
  DEGRADED: 'warn',
  OFFLINE: 'danger',
  ESTOP: 'danger',
  BINDING: 'analysis',
};

export function RobotInspector() {
  const snap = useNexus((s) => s.snap);
  const id = useNexus((s) => s.selectedRobot);
  const setFollow = useNexus((s) => s.setFollow);
  const followId = useNexus((s) => s.followId);
  const openBinding = useNexus((s) => s.openBinding);
  const notify = useNexus((s) => s.notify);
  const selectRobot = useNexus((s) => s.selectRobot);
  const toggleLayer = useNexus((s) => s.toggleLayer);
  const layers = useNexus((s) => s.layers);

  const r = snap.robots.find((x) => x.id === id);
  const ctx = id ? snap.contexts[id] : undefined;
  const perc = id ? snap.perceptions[id] : undefined;
  if (!r) return null;

  const agent = runtime.engine.agent(r.id);
  const task = r.taskId ? snap.tasks.find((t) => t.id === r.taskId) : undefined;
  const bat = r.battery;
  const batTone: Tone = bat > 45 ? 'ok' : bat > 22 ? 'warn' : 'danger';
  const physical = r.executionMode === 'PHYSICAL';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── header ────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-start justify-between border-b border-line px-3 py-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="mono text-[17px] font-semibold leading-none text-txt">{r.id}</span>
            <Chip tone={physical ? 'ok' : 'steel'}>
              {physical ? (r.twin.hardwareClass === 'MOCK' ? 'REAL · MOCK HARDWARE' : `REAL · ${r.hardwareId}`) : 'SIMULATED'}
            </Chip>
            <Chip tone={STATUS_TONE[r.status] ?? 'default'}>
              <Dot tone={STATUS_TONE[r.status] ?? 'default'} pulse={r.status === 'MOVING'} />
              {r.status}
            </Chip>
          </div>
          <div className="mt-1 flex items-center gap-2 text-3xs uppercase tracking-[0.1em] text-txt3">
            <span>{r.name}</span>
            <span className="text-line2">·</span>
            <span>
              {physical ? `PHYSICAL BACKEND · ${r.hardwareId}` : 'SIMULATION BACKEND'}
            </span>
          </div>
        </div>
        <button className="btn-icon" onClick={() => selectRobot(null)} title="Close">
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* ── live state ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="BATTERY" value={bat.toFixed(0)} unit="%" tone={batTone} />
          <Stat label="VELOCITY" value={Math.abs(r.speed).toFixed(2)} unit="m/s" tone={Math.abs(r.speed) > 0.1 ? 'nav' : 'default'} />
          <Stat label="COMPLETED" value={r.completedTasks} unit="tasks" />
        </div>
        <div className="mt-2">
          <Bar value={bat} tone={batTone === 'ok' ? 'ok' : batTone === 'warn' ? 'warn' : 'danger'} />
        </div>

        <Divider label="TASK" />
        {task ? (
          <>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="mono text-[13px] font-semibold text-nav">{task.id}</span>
              <Chip tone={task.priority === 'CRITICAL' ? 'danger' : task.priority === 'HIGH' ? 'warn' : 'default'}>
                {task.priority}
              </Chip>
              <Chip tone="default">{task.phase}</Chip>
            </div>
            <KV k="PICK" v={task.from.label} />
            <KV k="DROP" v={task.to.label} />
            <KV k="PAYLOAD" v={r.carryingPackageId ? `${r.payloadKg.toFixed(1)} kg · ${r.carryingPackageId}` : 'EMPTY'} tone={r.carryingPackageId ? 'ok' : 'default'} />
            <button className="btn mt-2 w-full" onClick={() => useNexus.getState().selectTask(task.id)}>
              <Target size={12} />
              INSPECT ALLOCATION
            </button>
          </>
        ) : (
          <div className="rounded border border-dashed border-line2 p-3 text-center text-[11px] text-txt3">
            NO TASK ASSIGNED
            <div className="mt-1 text-3xs">BIDDING ON {snap.tasks.filter((t) => t.state === 'ANNOUNCED').length} OPEN AUCTION(S)</div>
          </div>
        )}

        {/* ── decision trace ──────────────────────────────────────────────── */}
        <Divider label="DECISION" />
        <div className="rounded border border-line2 bg-abyss/60 p-2.5">
          <div className="flex items-center gap-2">
            <Brain size={12} className="text-analysis" />
            <span className="mono text-[12px] font-semibold text-analysis">{r.lastDecision?.kind ?? '—'}</span>
            <span className="ml-auto text-3xs text-txt3">
              CONF {(r.lastDecision?.confidence ?? 0).toFixed(2)}
            </span>
          </div>
          <div className="mt-1.5 text-[11px] leading-snug text-txt2">{r.lastDecision?.reason ?? '—'}</div>
          {!!r.lastDecision?.factors?.length && (
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line/70 pt-2">
              {r.lastDecision.factors.map((f, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2">
                  <span className="text-3xs uppercase tracking-[0.1em] text-txt3">{f.label}</span>
                  <span className="mono text-[10px] text-txt">{f.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── own context ─────────────────────────────────────────────────── */}
        {ctx && (
          <>
            <Divider label="INDIVIDUAL CONTEXT" />
            <div className="mb-2 flex items-center gap-2 rounded border border-nav/25 bg-nav/[0.08] px-2 py-1.5">
              <Eye size={11} className="shrink-0 text-nav" />
              <span className="text-3xs leading-tight text-txt2">
                Derived from this agent&apos;s own sensors, memory and comms — not shared with any other agent.
              </span>
              <span className="mono ml-auto shrink-0 text-3xs text-nav">SIG {ctx.signature}</span>
            </div>
            <KV k="ZONE" v={ctx.location.zoneKind ?? '—'} />
            <KV k="IN AISLE" v={ctx.location.inAisle ? `YES · ${ctx.location.aisleWidth.toFixed(1)}m` : 'NO'} />
            <KV k="NEARBY ROBOTS" v={`${ctx.traffic.nearbyCount} within ${(perc?.radius ?? 0).toFixed(1)}m`} tone={ctx.traffic.nearbyCount > 1 ? 'warn' : 'default'} />
            <KV k="LOCAL DENSITY" v={`${(ctx.traffic.localDensity * 100).toFixed(0)}%`} />
            <KV k="PREDICTED CONFLICTS" v={`${ctx.traffic.predictedConflicts.length}`} tone={ctx.traffic.predictedConflicts.length ? 'warn' : 'ok'} />
            <KV k="PLAN" v={ctx.self.planValid ? `VALID · ${ctx.self.planRemaining.toFixed(1)}m` : 'INVALIDATED'} tone={ctx.self.planValid ? 'ok' : 'danger'} />
            <KV k="OBSTACLE AHEAD" v={ctx.obstacles.ahead ? `${ctx.obstacles.ahead.distance.toFixed(1)}m` : 'NONE'} tone={ctx.obstacles.ahead ? 'warn' : 'default'} />
            <KV k="ETA" v={ctx.task.eta ? `${ctx.task.eta.toFixed(1)}s` : '—'} />
            <KV k="NEEDS CHARGE" v={ctx.energy.needsCharge ? 'YES' : 'NO'} tone={ctx.energy.needsCharge ? 'warn' : 'default'} />
            <KV k="COMMS" v={ctx.comms.connected ? `${ctx.comms.latencyMs.toFixed(0)}ms · ${ctx.comms.packetLoss.toFixed(1)}% loss` : 'DISCONNECTED'} tone={ctx.comms.degraded ? 'warn' : 'ok'} />

            <div className="mt-2 flex flex-wrap gap-1">
              {ctx.summary.map((s, i) => (
                <span key={i} className="rounded-sm border border-line2 bg-raised/40 px-1.5 py-[2px] text-3xs uppercase tracking-[0.08em] text-txt2">
                  {s}
                </span>
              ))}
            </div>
          </>
        )}

        {/* ── perception ──────────────────────────────────────────────────── */}
        {perc && (
          <>
            <Divider label="PERCEPTION" />
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-3xs uppercase tracking-[0.1em] text-txt3">
                DETECTED ROBOTS · {perc.detectedRobots.length}
              </span>
              <button
                className={clsx('text-3xs uppercase tracking-[0.1em]', layers.perception ? 'text-nav' : 'text-txt3 hover:text-txt2')}
                onClick={() => toggleLayer('perception')}
              >
                {layers.perception ? 'OVERLAY ON' : 'SHOW OVERLAY'}
              </button>
            </div>
            {perc.detectedRobots.length === 0 && (
              <div className="text-3xs text-txt3">NOTHING IN SENSOR RANGE</div>
            )}
            {perc.detectedRobots.slice(0, 5).map((d) => (
              <div key={d.id} className="flex items-center gap-2 border-b border-line/40 py-1 last:border-0">
                <span className="mono w-8 text-[11px] text-txt">{d.id}</span>
                <span className="mono text-[10px] text-txt3">{d.distance.toFixed(1)}m</span>
                {d.viaComms && <Chip tone="analysis">COMMS</Chip>}
                {d.critical && <Chip tone="danger">CRITICAL</Chip>}
                {d.yieldTo && <Chip tone="warn">YIELD</Chip>}
                {d.real && <Chip tone="ok">REAL</Chip>}
              </div>
            ))}
            {perc.detectedObstacles.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-3xs uppercase tracking-[0.1em] text-txt3">DETECTED OBSTACLES</div>
                {perc.detectedObstacles.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 py-[3px]">
                    <ShieldAlert size={10} className={o.blocksPath ? 'text-danger' : 'text-warn'} />
                    <span className="mono text-[10px] text-txt2">{o.id}</span>
                    <span className="mono ml-auto text-[10px] text-txt3">{o.distance.toFixed(1)}m</span>
                    {o.blocksPath && <Chip tone="danger">BLOCKS ROUTE</Chip>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── plan ────────────────────────────────────────────────────────── */}
        {r.plan && (
          <>
            <Divider label="ACTIVE PLAN" />
            <KV k="COST" v={r.plan.cost.toFixed(2)} />
            <KV k="LENGTH" v={`${r.plan.length.toFixed(1)} m`} />
            <KV k="REVISION" v={`r${r.plan.revision}`} tone={r.plan.revision > 1 ? 'analysis' : 'default'} />
            <KV k="REPLAN REASON" v={r.plan.replanReason ?? 'INITIAL'} />
            <KV k="TOTAL REPLANS" v={`${r.replanCount}`} />
          </>
        )}

        {/* ── digital twin ────────────────────────────────────────────────── */}
        {physical && (
          <>
            <Divider label="DIGITAL TWIN" />
            <div className="mb-2 rounded border border-ok/25 bg-ok/[0.08] p-2">
              <div className="flex items-center gap-2">
                <Radio size={11} className="text-ok" />
                <span className="text-2xs font-semibold uppercase tracking-[0.1em] text-ok">
                  {r.twin.sync}
                </span>
                <span className="mono ml-auto text-3xs text-txt3">{r.hardwareId}</span>
              </div>
              <div className="mt-1 text-3xs leading-tight text-txt2">
                Physical telemetry is authoritative for this robot&apos;s state.
              </div>
            </div>
            <KV k="POSITION ERROR" v={`${r.twin.positionError.toFixed(3)} m`} tone={r.twin.positionError > 0.2 ? 'warn' : 'ok'} />
            <KV k="TELEMETRY AGE" v={`${r.twin.telemetryAge.toFixed(3)} s`} tone={r.twin.telemetryAge > 0.5 ? 'warn' : 'ok'} />
            <KV k="PACKETS RX" v={`${r.twin.packetsReceived}`} />
            <KV k="PACKETS DROP" v={`${r.twin.packetsDropped}`} tone={r.twin.packetsDropped > 0 ? 'warn' : 'ok'} />
            <KV k="LINK" v={`${r.twin.latencyMs.toFixed(0)} ms`} />
            <KV k="HW BATTERY" v={`${r.twin.batteryReported.toFixed(1)} %`} />
          </>
        )}

        {/* ── binding ─────────────────────────────────────────────────────── */}
        {(r.binding.stage !== 'IDLE' || physical) && (
          <>
            <Divider label="EXECUTION BINDING" />
            <KV k="STAGE" v={r.binding.stage} tone={r.binding.stage === 'COMPATIBILITY_FAIL' ? 'danger' : 'analysis'} />
            <KV k="HARDWARE" v={r.binding.hardwareId ?? '—'} />
            <KV k="CLASS" v={r.binding.hardwareClass} />
            <KV k="CMDS REJECTED" v={`${r.binding.rejectedCommands}`} tone={r.binding.rejectedCommands ? 'warn' : 'ok'} />
            {r.binding.lastRejection && <KV k="LAST REJECT" v={r.binding.lastRejection} tone="warn" />}
          </>
        )}
      </div>

      {/* ── actions ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-line p-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            className={clsx('btn', followId === r.id && 'btn-primary')}
            onClick={() => setFollow(followId === r.id ? null : r.id)}
          >
            <Crosshair size={12} />
            {followId === r.id ? 'UNFOLLOW' : 'FOLLOW'}
          </button>
          <button className="btn" onClick={() => toggleLayer('perception')}>
            <Eye size={12} />
            PERCEPTION
          </button>

          {physical ? (
            <button
              className="btn btn-danger col-span-2"
              disabled={r.binding.stage !== 'IDLE'}
              onClick={() => {
                runtime.engine.requestUnbind(r.id);
                notify(`RELEASING ${r.hardwareId} FROM ${r.id} · SAFE STATE FIRST`, 'WARNING');
              }}
            >
              <Unlink size={12} />
              {r.binding.stage === 'IDLE' ? `UNBIND FROM ${r.hardwareId}` : 'RELEASING…'}
            </button>
          ) : (
            <button
              className="btn btn-primary col-span-2"
              disabled={r.binding.stage !== 'IDLE' || r.status === 'OFFLINE'}
              onClick={() => openBinding(r.id)}
            >
              <Link2 size={12} />
              DEPLOY TO PHYSICAL
            </button>
          )}

          {r.status === 'OFFLINE' ? (
            <button
              className="btn btn-ok col-span-2"
              onClick={() => {
                runtime.engine.reviveRobot(r.id);
                notify(`${r.id} RETURNED TO SERVICE`, 'SUCCESS');
              }}
            >
              <Activity size={12} />
              RETURN TO SERVICE
            </button>
          ) : (
            <button
              className="btn btn-danger col-span-2"
              onClick={() => {
                runtime.engine.killRobot(r.id, 'OPERATOR FAULT INJECTION');
                notify(`${r.id} FAULT INJECTED · TASK RETURNED TO AUCTION`, 'CRITICAL');
              }}
            >
              <WifiOff size={12} />
              INJECT ROBOT FAILURE
            </button>
          )}
          <button
            className="btn col-span-2"
            onClick={() => {
              runtime.engine.estop(r.id);
              notify(`${r.id} EMERGENCY STOP`, 'CRITICAL');
            }}
          >
            <ShieldAlert size={12} />
            EMERGENCY STOP {r.id}
          </button>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2 text-3xs text-txt3">
          <span className="flex items-center gap-1">
            <Navigation size={9} /> {(r.pose.x).toFixed(1)},{(r.pose.y).toFixed(1)}
          </span>
          <span className="flex items-center gap-1">
            <Route size={9} /> {r.distanceTravelled.toFixed(0)}m
          </span>
          <span className="flex items-center gap-1">
            {r.connected ? <Wifi size={9} /> : <WifiOff size={9} />} {r.latencyMs.toFixed(0)}ms
          </span>
        </div>
      </div>
    </div>
  );
}

export function robotTone(r: RobotState): Tone {
  return STATUS_TONE[r.status] ?? 'default';
}

export { BatteryCharging, MapPin, PackageIcon, Zap };
