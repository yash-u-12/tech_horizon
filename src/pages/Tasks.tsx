import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ListChecks, Package, Timer } from 'lucide-react';
import { useNexus } from '@/store/useNexus';
import { runtime } from '@/simulation/runtime';
import { TaskInspector } from '@/components/TaskInspector';
import { Chip, Dot, Empty, Panel, Segmented, Stat, type Tone } from '@/components/ui';

const STATE_TONE: Record<string, Tone> = {
  QUEUED: 'steel',
  ASSIGNED: 'nav',
  IN_PROGRESS: 'nav',
  COMPLETED: 'ok',
  FAILED: 'danger',
  REASSIGNING: 'analysis',
  CANCELLED: 'steel',
};

const FILTERS = [
  { id: 'ALL', label: 'ALL' },
  { id: 'QUEUED', label: 'OPEN' },
  { id: 'ACTIVE', label: 'ACTIVE' },
  { id: 'COMPLETED', label: 'DONE' },
  { id: 'FAILED', label: 'FAILED' },
] as const;

export function Tasks() {
  const snap = useNexus((s) => s.snap);
  const selectedTask = useNexus((s) => s.selectedTask);
  const selectTask = useNexus((s) => s.selectTask);
  const notify = useNexus((s) => s.notify);
  const [filter, setFilter] = useState<string>('ALL');

  const tasks = useMemo(() => {
    const byState = (s: string) => {
      if (s === 'ACTIVE') return snap.tasks.filter((t) => t.assignedTo && t.state !== 'COMPLETED' && t.state !== 'FAILED');
      return snap.tasks.filter((t) => t.state === s);
    };
    const list = filter === 'ALL' ? [...snap.tasks] : byState(filter);
    const order: Record<string, number> = { REASSIGNING: 0, QUEUED: 1, ASSIGNED: 2, IN_PROGRESS: 3, FAILED: 4, CANCELLED: 5, COMPLETED: 6 };
    return list.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || b.createdAt - a.createdAt);
  }, [snap.tasks, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { QUEUED: 0, ACTIVE: 0, COMPLETED: 0, FAILED: 0, REASSIGNING: 0 };
    for (const t of snap.tasks) {
      if (t.state === 'COMPLETED') c.COMPLETED++;
      else if (t.state === 'FAILED') c.FAILED++;
      else if (t.state === 'REASSIGNING') c.REASSIGNING++;
      else if (t.assignedTo) c.ACTIVE++;
      else c.QUEUED++;
    }
    return c;
  }, [snap.tasks]);

  const breached = snap.tasks.filter((t) => t.state !== 'COMPLETED' && snap.time - t.createdAt > t.slaSeconds).length;

  return (
    <div className="flex min-h-0 flex-1 gap-3 bg-void p-3">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {/* ── summary ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-5 gap-3">
          <div className="panel p-3"><Stat label="OPEN AUCTIONS" value={`${counts.QUEUED}`} tone="analysis" /></div>
          <div className="panel p-3"><Stat label="IN EXECUTION" value={`${counts.ACTIVE}`} tone="nav" /></div>
          <div className="panel p-3"><Stat label="COMPLETED" value={`${counts.COMPLETED}`} tone="ok" /></div>
          <div className="panel p-3"><Stat label="REASSIGNED" value={`${snap.metrics.reassignments}`} tone="warn" /></div>
          <div className="panel p-3"><Stat label="SLA BREACHES" value={`${breached}`} tone={breached ? 'danger' : 'ok'} /></div>
        </div>

        {/* ── ledger ──────────────────────────────────────────────────────── */}
        <Panel
          className="min-h-0 flex-1"
          dense
          title={
            <span className="flex items-center gap-2">
              <ListChecks size={12} className="text-txt3" />
              ALLOCATION LEDGER
            </span>
          }
          right={<Segmented size="xs" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ id: f.id as string, label: f.label }))} />}
        >
          <div className="h-full overflow-auto">
            <table className="w-full min-w-[860px]">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr>
                  <th className="th text-left">TASK</th>
                  <th className="th text-center">PRI</th>
                  <th className="th text-center">STATE</th>
                  <th className="th text-left">ROUTE</th>
                  <th className="th text-center">AGENT</th>
                  <th className="th text-center">BIDS</th>
                  <th className="th text-right">COST</th>
                  <th className="th text-right">AGE</th>
                  <th className="th text-right">SLA</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const age = snap.time - t.createdAt;
                  const slaLeft = t.slaSeconds - age;
                  const sel = selectedTask === t.id;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => selectTask(t.id)}
                      className={clsx(
                        'cursor-pointer border-t border-line/50 transition-colors',
                        sel ? 'bg-nav/[0.12]' : 'hover:bg-panel2/60',
                      )}
                    >
                      <td className="px-2 py-1.5">
                        <span className="mono text-[11px] font-semibold text-txt">{t.id}</span>
                        {t.reassignCount > 0 && (
                          <span className="ml-1 mono text-3xs text-warn">↻{t.reassignCount}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <Chip tone={t.priority === 'CRITICAL' ? 'danger' : t.priority === 'HIGH' ? 'warn' : 'default'}>
                          {t.priority[0]}
                        </Chip>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <Chip tone={STATE_TONE[t.state] ?? 'default'}>
                          <Dot tone={STATE_TONE[t.state] ?? 'default'} pulse={t.state === 'QUEUED'} />
                          {t.state}
                        </Chip>
                      </td>
                      <td className="max-w-[260px] px-2 py-1.5">
                        <div className="flex items-center gap-1.5 truncate text-[11px] text-txt2">
                          <span className="truncate">{t.from.label}</span>
                          <span className="text-txt3">→</span>
                          <span className="truncate">{t.to.label}</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center mono text-[11px] text-nav">{t.assignedTo ?? '—'}</td>
                      <td className="px-2 py-1.5 text-center mono text-[11px] text-txt2">
                        {t.bids.length ? `${t.bids.filter((b) => b.accepted).length}/${t.bids.length}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right mono text-[11px] text-txt2">
                        {t.bids.filter((b) => b.accepted).length
                          ? Math.min(...t.bids.filter((b) => b.accepted).map((b) => b.cost)).toFixed(2)
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right mono text-[11px] text-txt3">{age.toFixed(0)}s</td>
                      <td className="px-2 py-1.5 text-right">
                        <span
                          className={clsx(
                            'mono text-[11px]',
                            t.state === 'COMPLETED' ? 'text-ok' : slaLeft < 0 ? 'text-danger' : slaLeft < 20 ? 'text-warn' : 'text-txt2',
                          )}
                        >
                          {t.state === 'COMPLETED' ? 'MET' : `${slaLeft.toFixed(0)}s`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!tasks.length && <Empty>NO TASKS IN THIS FILTER</Empty>}
          </div>
        </Panel>

        <div className="flex shrink-0 items-center gap-3 rounded border border-line2 bg-abyss/40 px-3 py-2">
          <Timer size={12} className="text-txt3" />
          <span className="text-3xs leading-relaxed text-txt3">
            Allocation is a market, not a queue. The task board announces; every eligible agent
            evaluates the announcement against its own distance, battery, workload and congestion
            context and returns a bid; the winner is selected by a deterministic rule that every agent
            can evaluate on its own. If an agent dies mid-task, the task returns to the auction with
            its original SLA clock intact.
          </span>
          <button
            className="btn btn-primary shrink-0"
            onClick={() => {
              const t = runtime.engine.forceOrder();
              runtime.emit();
              if (t) {
                selectTask(t.id);
                notify(`${t.id} INJECTED · ANNOUNCED TO FLEET`, 'SUCCESS');
              }
            }}
          >
            <Package size={12} />
            INJECT ORDER
          </button>
        </div>
      </div>

      {/* ── detail ────────────────────────────────────────────────────────── */}
      <div className="w-[360px] shrink-0">
        <Panel className="h-full" dense>
          {selectedTask ? (
            <TaskInspector />
          ) : (
            <Empty>
              SELECT A TASK TO SEE ITS
              <br />
              LIFECYCLE, BIDS AND ALLOCATION REASONING
            </Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
