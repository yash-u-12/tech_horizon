import clsx from 'clsx';
import { CheckCircle2, Clock, Package, Route, Target, X } from 'lucide-react';
import { useNexus } from '@/store/useNexus';
import { Chip, Divider, Dot, KV, Stat, type Tone } from './ui';

const STATE_TONE: Record<string, Tone> = {
  QUEUED: 'steel',
  ASSIGNED: 'nav',
  IN_PROGRESS: 'nav',
  COMPLETED: 'ok',
  FAILED: 'danger',
  REASSIGNING: 'analysis',
  CANCELLED: 'steel',
};

/** the real lifecycle states the task board walks through */
const LIFECYCLE = ['QUEUED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

export function TaskInspector() {
  const snap = useNexus((s) => s.snap);
  const id = useNexus((s) => s.selectedTask);
  const selectTask = useNexus((s) => s.selectTask);
  const selectRobot = useNexus((s) => s.selectRobot);

  const t = snap.tasks.find((x) => x.id === id);
  if (!t) return null;
  const bids = t.bids;
  const winner = bids.reduce<(typeof bids)[number] | null>((a, b) => (!a || b.cost < a.cost ? b : a), null);
  const stage = LIFECYCLE.indexOf(t.state);
  const remaining = t.slaSeconds - (snap.time - t.createdAt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between border-b border-line px-3 py-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="mono text-[17px] font-semibold leading-none text-txt">{t.id}</span>
            <Chip tone={STATE_TONE[t.state] ?? 'default'}>
              <Dot tone={STATE_TONE[t.state] ?? 'default'} pulse={t.state === 'QUEUED'} />
              {t.state}
            </Chip>
            <Chip tone={t.priority === 'CRITICAL' ? 'danger' : t.priority === 'HIGH' ? 'warn' : 'default'}>
              {t.priority}
            </Chip>
            {t.source === 'MANUAL' && <Chip tone="danger">MANUAL PRIORITY</Chip>}
          </div>
          <div className="mt-1 text-3xs uppercase tracking-[0.1em] text-txt3">
            {t.assignedTo
              ? `ALLOCATED TO ${t.assignedTo}`
              : t.state === 'ANNOUNCED' ? 'EVALUATING ELIGIBLE ROBOTS'
                : t.state === 'QUEUED' ? 'WAITING FOR A SUITABLE ROBOT'
                  : t.state}
          </div>
        </div>
        <button className="btn-icon" onClick={() => selectTask(null)}>
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* ── route ───────────────────────────────────────────────────────── */}
        <div className="rounded border border-line2 bg-abyss/60 p-2.5">
          <div className="flex items-center gap-2">
            <Dot tone="ok" />
            <div className="min-w-0">
              <div className="label">PICK</div>
              <div className="truncate text-[12px] text-txt">{t.from.label}</div>
            </div>
            <span className="mono ml-auto shrink-0 text-3xs text-txt3">
              {t.from.x.toFixed(1)},{t.from.y.toFixed(1)}
            </span>
          </div>
          <div className="my-1.5 ml-[3px] h-3 border-l border-dashed border-line2" />
          <div className="flex items-center gap-2">
            <Dot tone="nav" />
            <div className="min-w-0">
              <div className="label">DROP</div>
              <div className="truncate text-[12px] text-txt">{t.to.label}</div>
            </div>
            <span className="mono ml-auto shrink-0 text-3xs text-txt3">
              {t.to.x.toFixed(1)},{t.to.y.toFixed(1)}
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat label="PAYLOAD" value={t.weightKg.toFixed(1)} unit="kg" />
          <Stat label="SLA" value={remaining.toFixed(0)} unit="s" tone={remaining < 15 ? 'danger' : remaining < 35 ? 'warn' : 'default'} />
          <Stat label="REASSIGNS" value={`${t.reassignCount}`} tone={t.reassignCount > 0 ? 'warn' : 'default'} />
        </div>

        {/* ── lifecycle ───────────────────────────────────────────────────── */}
        <Divider label="LIFECYCLE" />
        <div className="flex flex-wrap gap-1">
          {LIFECYCLE.map((s, i) => {
            const done = stage > i && !['FAILED', 'REASSIGNING', 'CANCELLED'].includes(t.state);
            const cur = stage === i;
            return (
              <span
                key={s}
                className={clsx(
                  'rounded-sm border px-1.5 py-[2px] text-3xs font-semibold uppercase tracking-[0.08em]',
                  cur ? 'border-nav/60 bg-nav/[0.16] text-nav'
                    : done ? 'border-line2 bg-raised/40 text-txt3'
                      : 'border-line/60 text-txt3/50',
                )}
              >
                {s}
              </span>
            );
          })}
          {['REASSIGNING', 'FAILED', 'CANCELLED'].includes(t.state) && (
            <span className="rounded-sm border border-analysis/50 bg-analysis/10 px-1.5 py-[2px] text-3xs font-semibold uppercase tracking-[0.08em] text-analysis">
              {t.state}
            </span>
          )}
        </div>

        <div className="mt-2">
          <KV k="CREATED" v={`${t.createdAt.toFixed(1)}s`} />
          <KV k="SOURCE" v={t.source === 'MANUAL' ? 'MANUAL ORDER' : t.source} />
          <KV k="ANNOUNCED" v={`${(t.announcedAt ?? t.createdAt).toFixed(1)}s`} />
          <KV k="ASSIGNED" v={t.assignedTo ? `${t.assignedTo} @ ${(t.assignedAt ?? 0).toFixed(1)}s` : '—'} tone={t.assignedTo ? 'nav' : 'default'} />
          <KV k="STARTED" v={t.startedAt !== undefined ? `${t.startedAt.toFixed(1)}s` : '—'} />
          <KV k="COMPLETED" v={t.completedAt ? `${t.completedAt.toFixed(1)}s` : '—'} tone={t.completedAt ? 'ok' : 'default'} />
          <KV k="REQUIRES LIDAR" v={t.requiresLidar ? 'YES' : 'NO'} />
          <KV k="REASSIGNMENTS" v={`${t.reassignCount}`} tone={t.reassignCount ? 'analysis' : 'default'} />
        </div>

        {!t.assignedTo && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(t.state) && (
          <div className="mt-2 rounded border border-warn/30 bg-warn/[0.06] p-2 text-[11px] text-warn">
            {t.allocationReason ?? 'Awaiting allocation evaluation.'}
          </div>
        )}

        <Divider label="ALLOCATION TRACE" />
        {t.trace.length ? (
          <div className="space-y-1">
            {t.trace.slice(-60).map((event, index) => (
              <div key={`${event.at}-${event.event}-${event.robotId ?? ''}-${index}`} className="rounded border border-line/50 bg-abyss/40 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="mono text-3xs text-txt3">{event.at.toFixed(1)}s</span>
                  <span className="text-3xs font-semibold uppercase tracking-wider text-nav">{event.event.replace(/_/g, ' ')}</span>
                  {event.robotId && <span className="mono ml-auto text-3xs text-txt2">{event.robotId}</span>}
                </div>
                <div className="mt-0.5 text-3xs leading-snug text-txt2">{event.detail}</div>
                {(event.cost !== undefined || event.distance !== undefined || event.eta !== undefined) && (
                  <div className="mt-0.5 mono text-[9px] text-txt3">
                    {event.distance !== undefined && `ROUTE ${event.distance.toFixed(1)}m · `}
                    {event.eta !== undefined && `ETA ${event.eta.toFixed(1)}s · `}
                    {event.cost !== undefined && `COST ${event.cost.toFixed(2)}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : <div className="text-3xs text-txt3">No allocation events recorded.</div>}

        {/* ── allocation bids ─────────────────────────────────────────────── */}
        <Divider label="ALLOCATION INSIGHTS · CANDIDATE DECISIONS" />
        {bids.length === 0 ? (
          <div className="rounded border border-dashed border-line2 p-3 text-center text-[11px] text-txt3">
            NO BIDS RECEIVED YET
          </div>
        ) : (
          <>
            <div className="mb-1.5 text-3xs leading-tight text-txt3">
              Candidate evaluations are recorded by the task board. Only accepted bids with a feasible route can be selected.
            </div>
            {[...bids]
              .sort((a, b) => Number(b.accepted) - Number(a.accepted) || a.cost - b.cost)
              .map((b) => {
                const won = b.robotId === t.assignedTo;
                const robot = snap.robots.find((r) => r.id === b.robotId);
                return (
                  <div
                    key={b.robotId}
                    className={clsx(
                      'mb-1 rounded border p-2 transition-colors',
                      won ? 'border-ok/40 bg-ok/[0.08]' : 'border-line2 bg-abyss/40',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        className={clsx('mono text-[12px] font-semibold hover:underline', won ? 'text-ok' : 'text-txt')}
                        onClick={() => selectRobot(b.robotId)}
                      >
                        {b.robotId}
                      </button>
                      {won && (
                        <Chip tone="ok">
                          <CheckCircle2 size={9} />
                          WON
                        </Chip>
                      )}
                      <span className="mono ml-auto text-3xs text-txt3">{robot?.status ?? 'UNKNOWN'}</span>
                      <span className="mono text-[13px] font-medium text-txt">{Number.isFinite(b.cost) ? b.cost.toFixed(2) : '—'}</span>
                    </div>
                    <div className={clsx('mb-1 text-3xs uppercase tracking-wider', b.accepted ? 'text-ok' : 'text-warn')}>
                      {b.accepted ? 'VALID ROUTE · ELIGIBLE' : `REJECTED · ${b.rejectedReason ?? b.reasoning}`}
                    </div>
                    {b.accepted && <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <KV k="ROBOT POSITION" v={robot ? `${robot.pose.x.toFixed(1)}, ${robot.pose.y.toFixed(1)}` : '—'} />
                      <KV k="ROUTE COST DISTANCE" v={`${(b.breakdown.distance ?? 0).toFixed(1)}m`} />
                      <KV k="ETA" v={`${(b.breakdown.eta ?? 0).toFixed(1)}s`} />
                      <KV k="BATTERY" v={`${(b.breakdown.battery ?? 0).toFixed(0)}%`} />
                      <KV k="CONGESTION" v={`${b.breakdown.congestion.toFixed(2)}`} />
                      <KV k="WORKLOAD" v={`${b.breakdown.workload.toFixed(2)}`} />
                      <KV k="EAGERNESS" v={`${b.breakdown.eagerness.toFixed(2)}`} />
                    </div>}
                    <div className="mt-1 border-t border-line/60 pt-1 text-3xs leading-tight text-txt3">
                      {b.reasoning}
                    </div>
                  </div>
                );
              })}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            className="btn"
            disabled={!t.assignedTo}
            onClick={() => selectRobot(t.assignedTo)}
          >
            <Target size={12} />
            VIEW AGENT
          </button>
          <button
            className="btn"
            onClick={() => {
              useNexus.getState().selectRobot(t.assignedTo ?? null);
              useNexus.getState().setFollow(t.assignedTo ?? null);
            }}
          >
            <Route size={12} />
            TRACK ON FLOOR
          </button>
        </div>
        <div className="mt-2 flex items-center gap-3 text-3xs text-txt3">
          <span className="flex items-center gap-1">
            <Clock size={9} /> {t.slaSeconds}s SLA
          </span>
          <span className="flex items-center gap-1">
            <Package size={9} /> {t.weightKg}kg
          </span>
        </div>
      </div>
    </div>
  );
}
