import { useMemo } from 'react';
import clsx from 'clsx';
import { Activity, Boxes, Check, Cpu, Radio, Timer, X, Zap } from 'lucide-react';
import { Scene } from '@/warehouse/Scene';
import { useNexus } from '@/store/useNexus';
import { RobotInspector } from '@/components/RobotInspector';
import { TaskInspector } from '@/components/TaskInspector';
import { BindingDialog } from '@/components/BindingDialog';
import { EventStream } from '@/components/EventStream';
import { Bar, Chip, Dot, Sparkline, Stat } from '@/components/ui';
import { runtime } from '@/simulation/runtime';

export function CommandCenter() {
  const snap = useNexus((s) => s.snap);
  const selectedRobot = useNexus((s) => s.selectedRobot);
  const selectedTask = useNexus((s) => s.selectedTask);
  const selectRobot = useNexus((s) => s.selectRobot);
  const hoverRobot = useNexus((s) => s.hoverRobot);
  const hoveredRobot = useNexus((s) => s.hoveredRobot);
  const pendingOrder = useNexus((s) => s.pendingOrder);
  const setPendingOrder = useNexus((s) => s.setPendingOrder);

  const throughput = useMemo(() => runtime.throughputHistory(), [snap.tick]);

  const critical = snap.events.filter((e) => e.severity === 'CRITICAL').length;
  const physicalCount = snap.robots.filter((r) => r.executionMode === 'PHYSICAL').length;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-void">
      <Scene />

      {pendingOrder && (
        <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-void/65 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-[420px] rounded-md border border-line2 bg-panel p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="label">CONFIRM MANUAL ORDER</div>
                <div className="mt-1 text-2xs text-txt3">The route is valid on the current warehouse navigation grid.</div>
              </div>
              <Chip tone="danger">CRITICAL</Chip>
              <button className="btn-icon" title="Cancel order" onClick={() => setPendingOrder(null)}><X size={13} /></button>
            </div>
            <div className="my-3 space-y-2 rounded border border-line2 bg-abyss/60 p-3">
              <div className="flex justify-between gap-3 text-2xs"><span className="text-ok">PICKUP</span><span className="mono text-txt">{pendingOrder.pickup.x.toFixed(1)}, {pendingOrder.pickup.y.toFixed(1)}</span></div>
              <div className="flex justify-between gap-3 text-2xs"><span className="text-nav">DESTINATION</span><span className="mono text-txt">{pendingOrder.destination.x.toFixed(1)}, {pendingOrder.destination.y.toFixed(1)}</span></div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setPendingOrder(null)}>CANCEL</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const result = runtime.engine.createManualOrder(pendingOrder.pickup, pendingOrder.destination);
                  if (!result.task) {
                    useNexus.getState().notify(result.error ?? 'The order could not be created.', 'WARNING');
                    return;
                  }
                  runtime.emit();
                  useNexus.getState().selectTask(result.task.id);
                  setPendingOrder(null);
                  useNexus.getState().notify(`${result.task.id} CONFIRMED · CRITICAL PRIORITY · ALLOCATION STARTED`, 'SUCCESS');
                }}
              >
                <Check size={12} /> CONFIRM ORDER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── top-left: fleet readiness ─────────────────────────────────────── */}
      <div className="pointer-events-auto absolute left-3 top-3 z-10 w-[286px] rounded-md border border-line2 bg-panel/95 shadow-xl backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Cpu size={12} className="text-txt3" />
          <span className="label">FLEET READINESS</span>
          <span className="mono ml-auto text-3xs text-txt3">
            {snap.fleet.activeRobots}/{snap.robots.length} ONLINE
          </span>
        </div>
        <div className="max-h-[236px] overflow-y-auto px-2 py-1.5">
          {snap.robots.map((r) => {
            const bat = r.battery;
            const tone = bat > 45 ? 'ok' : bat > 22 ? 'warn' : 'danger';
            const phys = r.executionMode === 'PHYSICAL';
            return (
              <button
                key={r.id}
                onMouseEnter={() => hoverRobot(r.id)}
                onMouseLeave={() => hoverRobot(null)}
                onClick={() => selectRobot(r.id)}
                className={clsx(
                  'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors',
                  selectedRobot === r.id ? 'bg-nav/[0.14]' : hoveredRobot === r.id ? 'bg-panel2/70' : 'hover:bg-panel2/50',
                )}
              >
                <span className={clsx('mono w-8 shrink-0 text-[11px] font-semibold', phys ? 'text-ok' : 'text-txt')}>
                  {r.id}
                </span>
                <Dot
                  tone={
                    r.status === 'OFFLINE' ? 'danger'
                      : r.status === 'MOVING' || r.status === 'PICKING' || r.status === 'DROPPING' ? 'nav'
                        : r.status === 'CHARGING' ? 'ok'
                          : r.status === 'WAITING' || r.status === 'DEGRADED' ? 'warn'
                            : 'steel'
                  }
                  pulse={r.status === 'MOVING'}
                />
                <span className="w-[74px] shrink-0 truncate text-3xs uppercase tracking-[0.08em] text-txt2">
                  {r.status}
                </span>
                <div className="w-11 shrink-0">
                  <Bar value={bat} tone={tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'danger'} height={2.5} />
                </div>
                <span className="mono w-7 shrink-0 text-right text-3xs text-txt3">{bat.toFixed(0)}%</span>
                <span className="mono w-14 shrink-0 text-right text-3xs truncate text-txt3">
                  {r.taskId ?? '—'}
                </span>
                {phys && <Chip tone="ok" className="ml-auto shrink-0">REAL</Chip>}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-line px-3 py-2">
          <Stat label="UTILISATION" value={`${(snap.fleet.utilisation * 100).toFixed(0)}`} unit="%" tone="nav" />
          <Stat label="COMPLETED" value={`${snap.fleet.tasksCompleted}`} tone="ok" />
          <Stat label="AVG LATENCY" value={`${snap.fleet.avgLatency.toFixed(0)}`} unit="ms" />
        </div>
      </div>

      {/* ── top-right: mode strip ─────────────────────────────────────────── */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <Chip tone={physicalCount ? 'ok' : 'steel'} className="pointer-events-auto bg-panel/95 shadow-lg">
          <Radio size={9} />
          {physicalCount} PHYSICAL · {snap.robots.length - physicalCount} SIMULATED
        </Chip>
        {critical > 0 && (
          <Chip tone="danger" className="pointer-events-auto bg-panel/95 shadow-lg">
            <Dot tone="danger" pulse />
            {critical} CRITICAL
          </Chip>
        )}
        {snap.activeScenario && (
          <Chip tone="nav" className="pointer-events-auto bg-panel/95 shadow-lg">
            <Activity size={9} />
            {snap.activeScenario} ENGAGED
          </Chip>
        )}
      </div>

      {/* ── bottom-left: event stream ─────────────────────────────────────── */}
      <div className="pointer-events-auto absolute bottom-3 left-3 z-10 w-[430px] rounded-md border border-line2 bg-panel/95 shadow-xl backdrop-blur-sm">
        <EventStream compact />
      </div>

      {/* ── bottom-centre: throughput ─────────────────────────────────────── */}
      <div className="pointer-events-auto absolute bottom-3 left-[460px] z-10 w-[320px] rounded-md border border-line2 bg-panel/95 shadow-xl backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <Zap size={11} className="text-txt3" />
          <span className="label">THROUGHPUT · TASKS / 10S</span>
          <span className="mono ml-auto text-[11px] text-txt">
            {throughput.length ? throughput[throughput.length - 1] : 0}
          </span>
        </div>
        <div className="px-2 py-1.5">
          <Sparkline data={throughput.length ? throughput : [0]} color="#34D399" height={34} width={300} />
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-line px-3 py-1.5">
          <Stat label="ACTIVE" value={`${snap.fleet.tasksActive}`} tone="nav" />
          <Stat label="OPEN AUCTIONS" value={`${snap.tasks.filter((t) => t.state === 'QUEUED').length}`} tone="analysis" />
          <Stat label="NEAR MISS" value={`${snap.metrics.nearMisses}`} tone={snap.metrics.nearMisses ? 'warn' : 'ok'} />
        </div>
      </div>

      {/* ── right: inspector ──────────────────────────────────────────────── */}
      {selectedRobot && (
        <div className="pointer-events-auto absolute bottom-3 right-3 top-3 z-20 w-[344px] rounded-md border border-line2 bg-panel shadow-2xl">
          <RobotInspector />
        </div>
      )}
      {selectedTask && !selectedRobot && (
        <div className="pointer-events-auto absolute bottom-3 right-3 top-3 z-20 w-[344px] rounded-md border border-line2 bg-panel shadow-2xl">
          <TaskInspector />
        </div>
      )}

      <BindingDialog />
    </div>
  );
}

export { Boxes, Timer };
