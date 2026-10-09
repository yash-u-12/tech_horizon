import clsx from 'clsx';
import { Activity, Cpu, Radio } from 'lucide-react';
import { Scene } from '@/warehouse/Scene';
import { useNexus } from '@/store/useNexus';
import { RobotInspector } from '@/components/RobotInspector';
import { TaskInspector } from '@/components/TaskInspector';
import { BindingDialog } from '@/components/BindingDialog';
import { Bar, Chip, Dot, Stat } from '@/components/ui';

export function CommandCenter() {
  const snap = useNexus((s) => s.snap);
  const selectedRobot = useNexus((s) => s.selectedRobot);
  const selectedTask = useNexus((s) => s.selectedTask);
  const selectRobot = useNexus((s) => s.selectRobot);
  const hoverRobot = useNexus((s) => s.hoverRobot);
  const hoveredRobot = useNexus((s) => s.hoveredRobot);

  const critical = snap.events.filter((e) => e.severity === 'CRITICAL').length;
  const physicalCount = snap.robots.filter((r) => r.executionMode === 'PHYSICAL').length;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-void">
      <Scene />

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
