import clsx from 'clsx';
import { BatteryCharging, Brain, Crosshair, Cpu, Eye, Link2, Radio, Route, ShieldAlert, Unlink, WifiOff } from 'lucide-react';
import { runtime } from '@/simulation/runtime';
import { useNexus } from '@/store/useNexus';
import { Bar, Chip, Dot, KV, Panel, Stat, type Tone } from '@/components/ui';
import { robotTone } from '@/components/RobotInspector';

export function Fleet() {
  const snap = useNexus((s) => s.snap);
  const selectRobot = useNexus((s) => s.selectRobot);
  const setPage = useNexus((s) => s.setPage);
  const setFollow = useNexus((s) => s.setFollow);
  const followId = useNexus((s) => s.followId);
  const openBinding = useNexus((s) => s.openBinding);
  const notify = useNexus((s) => s.notify);
  const hoverRobot = useNexus((s) => s.hoverRobot);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-void p-3">
      {/* ── summary ─────────────────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-6 gap-3">
        <div className="panel p-3">
          <Stat label="AGENTS ONLINE" value={`${snap.fleet.activeRobots}/${snap.robots.length}`} tone="ok" />
        </div>
        <div className="panel p-3">
          <Stat label="UTILISATION" value={`${(snap.fleet.utilisation * 100).toFixed(0)}`} unit="%" tone="nav" />
          <div className="mt-1.5"><Bar value={snap.fleet.utilisation * 100} tone="nav" /></div>
        </div>
        <div className="panel p-3">
          <Stat label="TASKS ACTIVE" value={`${snap.fleet.tasksActive}`} tone="nav" />
        </div>
        <div className="panel p-3">
          <Stat label="TASKS COMPLETED" value={`${snap.fleet.tasksCompleted}`} tone="ok" />
        </div>
        <div className="panel p-3">
          <Stat label="AVG BATTERY" value={`${(snap.robots.reduce((a, r) => a + r.battery, 0) / snap.robots.length).toFixed(0)}`} unit="%" />
        </div>
        <div className="panel p-3">
          <Stat label="AVG LATENCY" value={`${snap.fleet.avgLatency.toFixed(0)}`} unit="ms" tone={snap.fleet.avgLatency > 120 ? 'warn' : 'default'} />
        </div>
      </div>

      {/* ── agent registry ──────────────────────────────────────────────────── */}
      <div className="mb-1.5 flex items-center gap-2">
        <Cpu size={13} className="text-txt3" />
        <span className="label">AGENT REGISTRY</span>
        <span className="text-3xs text-txt3">
          each agent holds its own context, memory, planner and execution backend
        </span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-3">
        {snap.robots.map((r) => {
          const ctx = snap.contexts[r.id];
          const perc = snap.perceptions[r.id];
          const phys = r.executionMode === 'PHYSICAL';
          const bat = r.battery;
          const batTone: Tone = bat > 45 ? 'ok' : bat > 22 ? 'warn' : 'danger';
          const task = r.taskId ? snap.tasks.find((t) => t.id === r.taskId) : null;
          const tone = robotTone(r);

          return (
            <div
              key={r.id}
              onMouseEnter={() => hoverRobot(r.id)}
              onMouseLeave={() => hoverRobot(null)}
              className={clsx('panel flex flex-col p-0 transition-colors', phys ? 'border-ok/25' : '')}
            >
              {/* header */}
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="mono text-[15px] font-semibold text-txt">{r.id}</span>
                <Chip tone={phys ? 'ok' : 'steel'}>
                  {phys ? (r.twin.hardwareClass === 'MOCK' ? 'REAL · MOCK' : `REAL · ${r.hardwareId}`) : 'SIM'}
                </Chip>
                <Chip tone={tone}>
                  <Dot tone={tone} pulse={r.status === 'MOVING'} />
                  {r.status}
                </Chip>
                <span className="mono ml-auto text-3xs text-txt3">
                  {r.pose.x.toFixed(1)}, {r.pose.y.toFixed(1)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <Stat label="BATTERY" value={bat.toFixed(0)} unit="%" tone={batTone} />
                <Stat label="DONE" value={r.completedTasks} unit="tasks" />
                <Stat label="REPLANS" value={r.replanCount} tone={r.replanCount > 3 ? 'analysis' : 'default'} />
              </div>
              <div className="px-3 pb-2">
                <Bar value={bat} tone={batTone === 'ok' ? 'ok' : batTone === 'warn' ? 'warn' : 'danger'} />
              </div>

              {/* task */}
              <div className="border-t border-line px-3 py-2">
                {task ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <button className="mono text-[11px] font-semibold text-nav hover:underline" onClick={() => { useNexus.getState().selectTask(task.id); setPage('TASKS'); }}>
                        {task.id}
                      </button>
                      <Chip tone={task.priority === 'CRITICAL' ? 'danger' : task.priority === 'HIGH' ? 'warn' : 'default'}>{task.priority}</Chip>
                      <span className="ml-auto text-3xs uppercase tracking-[0.1em] text-txt3">{task.phase}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-txt2">→ {task.to.label}</div>
                  </>
                ) : (
                  <div className="text-[11px] text-txt3">NO TASK · BIDDING ON {snap.tasks.filter((t) => t.state === 'QUEUED').length} OPEN AUCTION(S)</div>
                )}
              </div>

              {/* decision */}
              <div className="border-t border-line px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Brain size={10} className="text-analysis" />
                  <span className="mono text-[11px] font-semibold text-analysis">{r.lastDecision?.kind ?? '—'}</span>
                  <span className="mono ml-auto text-3xs text-txt3">
                    CONF {(r.lastDecision?.confidence ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-txt2">
                  {r.lastDecision?.reason ?? '—'}
                </div>
              </div>

              {/* context */}
              {ctx && (
                <div className="border-t border-line px-3 py-2">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Eye size={10} className="text-nav" />
                    <span className="label">OWN CONTEXT</span>
                    <span className="mono ml-auto text-3xs text-nav">SIG {ctx.signature}</span>
                  </div>
                  <KV k="ZONE" v={ctx.location.zoneKind} />
                  <KV k="NEARBY" v={`${ctx.traffic.nearbyCount}`} tone={ctx.traffic.nearbyCount > 1 ? 'warn' : 'default'} />
                  <KV k="DENSITY" v={`${(ctx.traffic.localDensity * 100).toFixed(0)}%`} />
                  <KV k="PLAN" v={ctx.self.planValid ? 'VALID' : 'INVALIDATED'} tone={ctx.self.planValid ? 'ok' : 'danger'} />
                  <KV k="BLOCKED AHEAD" v={ctx.obstacles.ahead ? `${ctx.obstacles.ahead.distance.toFixed(1)}m` : 'NONE'} tone={ctx.obstacles.ahead ? 'warn' : 'default'} />
                  <KV k="SENSOR" v={`${perc?.detectedRobots.length ?? 0} peers / ${perc?.detectedObstacles.length ?? 0} obs`} />
                </div>
              )}

              {/* actions */}
              <div className="mt-auto grid grid-cols-2 gap-1.5 border-t border-line p-2.5">
                <button
                  className={clsx('btn', followId === r.id && 'btn-primary')}
                  onClick={() => {
                    setFollow(followId === r.id ? null : r.id);
                    useNexus.getState().setCameraMode(followId === r.id ? 'ORBIT' : 'FOLLOW');
                    setPage('COMMAND');
                  }}
                >
                  <Crosshair size={11} />
                  {followId === r.id ? 'UNFOLLOW' : 'FOLLOW'}
                </button>
                <button className="btn" onClick={() => { selectRobot(r.id); setPage('COMMAND'); }}>
                  <Route size={11} />
                  INSPECT
                </button>
                {phys ? (
                  <button className="btn btn-danger col-span-2" disabled={r.binding.stage !== 'IDLE'} onClick={() => { runtime.engine.requestUnbind(r.id); notify(`RELEASING ${r.hardwareId} FROM ${r.id}`, 'WARNING'); }}>
                    <Unlink size={11} />
                    UNBIND {r.hardwareId}
                  </button>
                ) : (
                  <button className="btn btn-primary col-span-2" disabled={r.binding.stage !== 'IDLE' || r.status === 'OFFLINE'} onClick={() => openBinding(r.id)}>
                    <Link2 size={11} />
                    DEPLOY TO PHYSICAL
                  </button>
                )}
                {r.status === 'OFFLINE' ? (
                  <button className="btn btn-ok col-span-2" onClick={() => { runtime.engine.reviveRobot(r.id); notify(`${r.id} RETURNED TO SERVICE`, 'SUCCESS'); }}>
                    <Radio size={11} />
                    RETURN TO SERVICE
                  </button>
                ) : (
                  <button className="btn col-span-2" onClick={() => { runtime.engine.killRobot(r.id, 'OPERATOR FAULT INJECTION'); notify(`${r.id} FAULT INJECTED`, 'CRITICAL'); }}>
                    <WifiOff size={11} />
                    INJECT FAILURE
                  </button>
                )}
                <button className="btn col-span-2" onClick={() => { runtime.engine.estop(r.id); notify(`${r.id} E-STOP`, 'CRITICAL'); }}>
                  <ShieldAlert size={11} />
                  EMERGENCY STOP
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── context divergence ──────────────────────────────────────────────── */}
      <Panel
        title="CONTEXT DIVERGENCE · SHARED ENVIRONMENT, INDIVIDUAL CONTEXT"
        bodyClass="overflow-x-auto"
        dense
      >
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="bg-abyss/70">
              <th className="th text-left">AGENT</th>
              <th className="th text-left">ZONE</th>
              <th className="th text-right">NEARBY</th>
              <th className="th text-right">DENSITY</th>
              <th className="th text-right">PRED. CONFLICTS</th>
              <th className="th text-left">PLAN</th>
              <th className="th text-left">OBSTACLE AHEAD</th>
              <th className="th text-right">ETA</th>
              <th className="th text-left">COMMS</th>
              <th className="th text-left">DECISION</th>
              <th className="th text-right">SIG</th>
            </tr>
          </thead>
          <tbody>
            {snap.robots.map((r) => {
              const c = snap.contexts[r.id];
              if (!c) return null;
              return (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-line/50 hover:bg-panel2/60"
                  onClick={() => { selectRobot(r.id); setPage('COMMAND'); }}
                >
                  <td className="px-2 py-1 mono text-[11px] font-semibold text-txt">{r.id}</td>
                  <td className="px-2 py-1 text-[11px] text-txt2">{c.location.zoneKind}</td>
                  <td className="px-2 py-1 mono text-right text-[11px] text-txt2">{c.traffic.nearbyCount}</td>
                  <td className="px-2 py-1 mono text-right text-[11px] text-txt2">{(c.traffic.localDensity * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1 mono text-right text-[11px]">{c.traffic.predictedConflicts.length}</td>
                  <td className="px-2 py-1 text-[11px]">
                    <span className={c.self.planValid ? 'text-ok' : 'text-danger'}>
                      {c.self.planValid ? `VALID ${c.self.planRemaining.toFixed(1)}m` : 'INVALIDATED'}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-[11px] text-txt2">
                    {c.obstacles.ahead ? `${c.obstacles.ahead.distance.toFixed(1)}m` : 'NONE'}
                  </td>
                  <td className="px-2 py-1 mono text-right text-[11px] text-txt2">{c.task.eta ? `${c.task.eta.toFixed(1)}s` : '—'}</td>
                  <td className="px-2 py-1 text-[11px]">
                    <span className={c.comms.degraded ? 'text-warn' : 'text-txt2'}>
                      {c.comms.connected ? `${c.comms.latencyMs.toFixed(0)}ms` : 'DOWN'}
                    </span>
                  </td>
                  <td className="px-2 py-1 mono text-[11px] text-analysis">{r.lastDecision?.kind ?? '—'}</td>
                  <td className="px-2 py-1 mono text-right text-3xs text-nav">{c.signature}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-line px-3 py-2 text-3xs leading-relaxed text-txt3">
          All agents observe the same warehouse through the same simulation clock, yet no two context
          signatures match: each one is built from a different sensor footprint, a different memory of
          blocked cells, a different set of received peer intents and a different personality bias.
          Two robots one metre apart routinely reach different conclusions — that is the point.
        </div>
      </Panel>

      <div className="mt-3 flex items-center gap-2 rounded border border-line2 bg-abyss/40 px-3 py-2">
        <BatteryCharging size={12} className="text-txt3" />
        <span className="text-3xs leading-relaxed text-txt3">
          Charging is a normal autonomous behaviour: an agent that drops below its own reserve
          threshold bids less aggressively, finishes what it is carrying, navigates to a free charger
          and returns to the auction when it has enough charge to work.
        </span>
      </div>
    </div>
  );
}
