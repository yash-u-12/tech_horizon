import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useNexus } from '@/store/useNexus';
import { Segmented } from './ui';
import type { SimEvent } from '@/simulation/types';

const SEV: Record<string, { text: string; bar: string; dot: string }> = {
  INFO: { text: 'text-txt2', bar: 'bg-steel', dot: 'bg-steel' },
  SUCCESS: { text: 'text-ok', bar: 'bg-ok', dot: 'bg-ok' },
  WARNING: { text: 'text-warn', bar: 'bg-warn', dot: 'bg-warn' },
  CRITICAL: { text: 'text-danger', bar: 'bg-danger', dot: 'bg-danger' },
};

const FILTERS = [
  { id: 'ALL', label: 'ALL' },
  { id: 'TASK', label: 'TASK' },
  { id: 'AGENT', label: 'AGENT' },
  { id: 'TRAFFIC', label: 'TRAFFIC' },
  { id: 'TWIN', label: 'TWIN' },
  { id: 'SYSTEM', label: 'SYS' },
] as const;

export function EventStream({ compact = false }: { compact?: boolean }) {
  const snap = useNexus((s) => s.snap);
  const filter = useNexus((s) => s.eventsFilter);
  const setFilter = useNexus((s) => s.setEventsFilter);
  const selectRobot = useNexus((s) => s.selectRobot);
  const selectTask = useNexus((s) => s.selectTask);
  const [hover, setHover] = useState<string | null>(null);

  const events = useMemo(() => {
    const list = snap.events;
    return filter === 'ALL' ? list : list.filter((e) => e.category === filter);
  }, [snap.events, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
        <span className="label">EVENT STREAM</span>
        <Segmented
          size="xs"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ id: f.id as string, label: f.label }))}
        />
      </div>
      <div className={clsx('min-h-0 flex-1 overflow-y-auto', compact ? 'max-h-[190px]' : '')}>
        {events.map((e) => (
          <EventRow
            key={e.id}
            e={e}
            active={hover === e.id}
            onHover={setHover}
            onRobot={e.robotId ? () => selectRobot(e.robotId!) : undefined}
            onTask={e.taskId ? () => selectTask(e.taskId!) : undefined}
          />
        ))}
        {!events.length && (
          <div className="p-4 text-center text-[11px] text-txt3">NO EVENTS IN THIS CATEGORY</div>
        )}
      </div>
    </div>
  );
}

function EventRow({
  e,
  active,
  onHover,
  onRobot,
  onTask,
}: {
  e: SimEvent;
  active: boolean;
  onHover: (id: string | null) => void;
  onRobot?: () => void;
  onTask?: () => void;
}) {
  const s = SEV[e.severity] ?? SEV.INFO;
  return (
    <div
      onMouseEnter={() => onHover(e.id)}
      onMouseLeave={() => onHover(null)}
      className={clsx(
        'group flex items-start gap-2 border-b border-line/40 px-3 py-[5px] transition-colors',
        active && 'bg-panel2/70',
      )}
    >
      <span className={clsx('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', s.dot)} />
      <span className="mono mt-[1px] shrink-0 text-[10px] tabular-nums text-txt3">{e.t.toFixed(1)}</span>
      <span
        className={clsx(
          'min-w-0 flex-1 text-[11px] leading-snug',
          s.text,
          (onRobot || onTask) && 'cursor-pointer group-hover:underline',
        )}
        onClick={onRobot ?? onTask}
      >
        {e.message}
      </span>
      <span className="shrink-0 text-3xs uppercase tracking-[0.1em] text-txt3 opacity-0 transition-opacity group-hover:opacity-100">
        {e.source}
      </span>
    </div>
  );
}
