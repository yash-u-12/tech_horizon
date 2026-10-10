import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import clsx from 'clsx';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Brackets,
  Clock,
  Filter,
  Gauge,
  GitBranch,
  Inbox,
  Network,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Search,
  Signal,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useNexus } from '@/store/useNexus';
import { Chip, Dot, Empty, KV, Panel, Segmented, Sparkline, Stat, type Tone } from '@/components/ui';
import type { CommsRecord, Message } from '@/simulation/communication/bus';
import type { RobotState } from '@/simulation/types';
import { WORLD_H, WORLD_W } from '@/simulation/environment/warehouse';
import { runtime } from '@/simulation/runtime';

type Category = 'ALL' | Message['kind'];
type FeedMode = 'LIVE' | 'PAUSED';
type RecStatus = 'DELIVERED' | 'PARTIAL' | 'DROPPED' | 'PENDING';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'ALL', label: 'ALL' },
  { id: 'INTENT', label: 'INTENT' },
  { id: 'TASK_ANNOUNCE', label: 'TASKS' },
  { id: 'TASK_BID', label: 'BIDS' },
  { id: 'STATUS', label: 'STATUS' },
  { id: 'HAZARD', label: 'HAZARD' },
  { id: 'ESTOP', label: 'SAFETY' },
];

const KIND_TONE: Record<Message['kind'], Tone> = {
  TASK_ANNOUNCE: 'analysis',
  TASK_BID: 'nav',
  TASK_CLAIM: 'ok',
  TASK_RELEASE: 'warn',
  TASK_DONE: 'ok',
  INTENT: 'steel',
  HAZARD: 'danger',
  STATUS: 'default',
  ESTOP: 'danger',
};

const KIND_COLOR: Record<Message['kind'], string> = {
  TASK_ANNOUNCE: '#A78BFA',
  TASK_BID: '#38BDF8',
  TASK_CLAIM: '#34D399',
  TASK_RELEASE: '#FBBF24',
  TASK_DONE: '#34D399',
  INTENT: '#64748B',
  HAZARD: '#F87171',
  STATUS: '#93A3B4',
  ESTOP: '#EF4444',
};

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

const REC_STATUS_TONE: Record<RecStatus, Tone> = {
  DELIVERED: 'ok',
  PARTIAL: 'warn',
  DROPPED: 'danger',
  PENDING: 'steel',
};

function recordStatus(r: CommsRecord): RecStatus {
  if (r.deliveredTo.length && !r.droppedFor.length) return 'DELIVERED';
  if (r.deliveredTo.length && r.droppedFor.length) return 'PARTIAL';
  if (!r.deliveredTo.length && r.droppedFor.length) return 'DROPPED';
  return 'PENDING';
}

function categoryOf(r: CommsRecord): Category {
  if (r.kind === 'TASK_CLAIM' || r.kind === 'TASK_RELEASE' || r.kind === 'TASK_DONE') return 'TASK_ANNOUNCE';
  return r.kind;
}

function categoryLabel(kind: Message['kind']) {
  return kind.replace('TASK_', '').replace('_', ' ');
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const tenths = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

function recipientsOf(r: CommsRecord) {
  return [...new Set([...r.deliveredTo, ...r.droppedFor])];
}

function sourceKind(id: string, robotIds: Set<string>) {
  if (robotIds.has(id)) return 'robot';
  if (id === 'WMS') return 'task-board';
  if (id === 'OPERATOR') return 'operator';
  return 'system';
}

function payloadSummary(payload: Message) {
  switch (payload.kind) {
    case 'INTENT':
      return `${payload.waypoints.length} planned waypoints, priority ${payload.priority}, speed ${payload.speed.toFixed(2)} m/s`;
    case 'TASK_ANNOUNCE':
      return `${payload.priority} task ${payload.taskId}, ${payload.weightKg.toFixed(1)} kg, SLA ${payload.sla}s`;
    case 'TASK_BID':
      return `${payload.bid.robotId} bid ${payload.bid.cost.toFixed(2)}, ETA ${payload.bid.eta}s, accepted ${payload.bid.accepted ? 'yes' : 'no'}`;
    case 'STATUS':
      return `${payload.status}, battery ${payload.battery.toFixed(0)}%, pose ${payload.pose.x.toFixed(1)}, ${payload.pose.y.toFixed(1)}`;
    case 'HAZARD':
      return `${payload.id} at ${payload.x.toFixed(1)}, ${payload.y.toFixed(1)}, radius ${payload.r.toFixed(1)}m`;
    case 'ESTOP':
      return `Emergency stop target ${payload.robotId}`;
    case 'TASK_CLAIM':
      return `Claim ${payload.taskId}, cost ${payload.cost.toFixed(2)}`;
    case 'TASK_RELEASE':
      return `Release ${payload.taskId}: ${payload.reason}`;
    case 'TASK_DONE':
      return `Task ${payload.taskId} complete`;
  }
}

export function CommunicationNoc() {
  const snap = useNexus((s) => s.snap);
  const robots = snap.robots;
  const records = snap.comms;
  const robotIds = useMemo(() => new Set(robots.map((r) => r.id)), [robots]);

  const [selectedRobot, setSelectedRobot] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedPair, setSelectedPair] = useState<{ a: string; b: string } | null>(null);
  const [category, setCategory] = useState<Category>('ALL');
  const [query, setQuery] = useState('');
  const [feedMode, setFeedMode] = useState<FeedMode>('LIVE');
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (feedMode === 'LIVE') feedEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [feedMode, records.length]);

  useEffect(() => {
    if (clearedAt != null && snap.time < clearedAt) setClearedAt(null);
  }, [clearedAt, snap.time]);

  const visibleRecords = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (clearedAt != null && r.at < clearedAt) return false;
      if (category !== 'ALL' && categoryOf(r) !== category && r.kind !== category) return false;
      if (selectedRobot && r.from !== selectedRobot && !r.deliveredTo.includes(selectedRobot) && !r.droppedFor.includes(selectedRobot)) return false;
      if (!q) return true;
      return [
        r.id,
        r.kind,
        r.from,
        r.taskId ?? '',
        r.summary,
        ...r.deliveredTo,
        ...r.droppedFor,
        payloadSummary(r.payload),
      ].some((v) => v.toLowerCase().includes(q));
    });
  }, [category, clearedAt, query, records, selectedRobot]);

  const selectedMessage = selectedMessageId
    ? records.find((r) => r.id === selectedMessageId) ?? null
    : visibleRecords[visibleRecords.length - 1] ?? null;

  const last10 = records.filter((r) => snap.time - r.at <= 10);
  const activeLinks = useMemo(() => {
    const links = new Set<string>();
    for (const r of records.slice(-120)) {
      if (!robotIds.has(r.from)) continue;
      for (const to of recipientsOf(r)) if (robotIds.has(to) && to !== r.from) links.add([r.from, to].sort().join('|'));
    }
    return links.size;
  }, [records, robotIds]);
  const mps = last10.length / 10;
  const connected = robots.filter((r) => r.connected && r.status !== 'OFFLINE').length;
  const statusTone: Tone = snap.commsStats.dropped > 0 || connected < robots.length ? 'warn' : records.length ? 'ok' : 'steel';
  const statusText = records.length
    ? connected < robots.length ? 'SIMULATED MESH DEGRADED' : 'SIMULATED MESH OBSERVING TRAFFIC'
    : 'NO OBSERVABLE BUS TRAFFIC YET';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-void p-3">
      <header className="panel shrink-0 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-3 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded border border-nav/40 bg-nav/10 text-nav">
            <Network size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold uppercase tracking-[0.18em] text-txt">
              Decentralized Communication Network
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-3xs uppercase tracking-[0.12em] text-txt3">
              <Chip tone={statusTone}>
                <Dot tone={statusTone} pulse={snap.running && records.length > 0} />
                {statusText}
              </Chip>
              <span>logical peer broadcasts observed from the simulation bus</span>
              <span>physical transport is labelled only when robot state reports physical execution</span>
            </div>
          </div>
          <button
            className={clsx('btn ml-auto', snap.running ? '' : 'btn-primary')}
            onClick={() => {
              runtime.engine.setRunning(!runtime.engine.running);
              runtime.emit();
            }}
          >
            {snap.running ? <Pause size={12} /> : <Play size={12} />}
            {snap.running ? 'PAUSE SIM' : 'RUN SIM'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-4 xl:grid-cols-8">
          <Metric label="ACTIVE ROBOTS" value={`${connected}/${robots.length}`} tone={connected === robots.length ? 'ok' : 'warn'} />
          <Metric label="MESSAGES / SEC" value={mps.toFixed(1)} tone={mps > 0 ? 'nav' : 'steel'} />
          <Metric label="SENT" value={snap.commsStats.sent} tone="default" />
          <Metric label="DELIVERED" value={snap.commsStats.delivered} tone="ok" />
          <Metric label="DROPPED" value={snap.commsStats.dropped} tone={snap.commsStats.dropped ? 'danger' : 'ok'} />
          <Metric label="PEER LINKS" value={activeLinks} tone="analysis" />
          <Metric label="AVG LATENCY" value={`${snap.avgLatency.toFixed(0)}ms`} tone={snap.avgLatency > 120 ? 'warn' : 'default'} />
          <Metric label="SIM TIME" value={fmtTime(snap.time)} tone="default" />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-h-0 grid-rows-[minmax(360px,1.2fr)_minmax(260px,0.8fr)] gap-3">
          <Panel
            dense
            className="min-h-0"
            title={<span className="flex items-center gap-2"><GitBranch size={12} className="text-txt3" /> Live Peer-to-Peer Topology</span>}
            right={
              <div className="flex items-center gap-2">
                <button className="btn px-2 py-1 text-3xs" onClick={() => { setSelectedRobot(null); setSelectedPair(null); }}>
                  <RotateCcw size={10} /> RESET VIEW
                </button>
                <Chip tone="steel">LOGICAL INTERACTIONS</Chip>
              </div>
            }
          >
            <Topology
              robots={robots}
              records={visibleRecords}
              now={snap.time}
              selectedRobot={selectedRobot}
              selectedPair={selectedPair}
              selectedMessageId={selectedMessageId}
              onSelectRobot={(id) => {
                setSelectedRobot(id);
                setSelectedPair(null);
              }}
              onSelectMessage={setSelectedMessageId}
              onSelectPair={setSelectedPair}
            />
          </Panel>

          <Panel
            dense
            className="min-h-0"
            title={<span className="flex items-center gap-2"><Inbox size={12} className="text-txt3" /> Live Communication Event Feed</span>}
            right={<FeedControls feedMode={feedMode} setFeedMode={setFeedMode} onClear={() => setClearedAt(snap.time)} />}
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <Segmented size="xs" value={category} onChange={setCategory} options={CATEGORIES} />
                <label className="relative ml-auto min-w-[220px] flex-1 sm:max-w-[360px]">
                  <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-txt3" />
                  <input
                    className="input py-1 pl-7 text-2xs"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search robot, category, task, payload"
                  />
                </label>
                {selectedRobot && (
                  <button className="btn px-2 py-1 text-3xs" onClick={() => setSelectedRobot(null)}>
                    <Filter size={10} /> CLEAR ROBOT
                  </button>
                )}
              </div>
              <EventFeed
                records={visibleRecords}
                robotIds={robotIds}
                selectedMessageId={selectedMessageId}
                onSelectMessage={setSelectedMessageId}
                onSelectRobot={setSelectedRobot}
                feedEndRef={feedEndRef}
              />
            </div>
          </Panel>
        </div>

        <aside className="grid min-h-0 grid-rows-[minmax(240px,0.8fr)_minmax(260px,1fr)_minmax(220px,0.75fr)] gap-3">
          <MessageInspector record={selectedMessage} robots={robots} />
          <RobotProfile robotId={selectedRobot} robots={robots} records={records} onSelectRobot={setSelectedRobot} />
          <Analytics robots={robots} records={records} now={snap.time} />
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone: Tone }) {
  return (
    <div className="bg-panel px-3 py-2">
      <Stat label={label} value={value} tone={tone === 'steel' ? 'default' : tone} />
    </div>
  );
}

function FeedControls({
  feedMode,
  setFeedMode,
  onClear,
}: {
  feedMode: FeedMode;
  setFeedMode: (m: FeedMode) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button className="btn px-2 py-1 text-3xs" onClick={() => setFeedMode(feedMode === 'LIVE' ? 'PAUSED' : 'LIVE')}>
        {feedMode === 'LIVE' ? <Pause size={10} /> : <Play size={10} />}
        {feedMode === 'LIVE' ? 'PAUSE FEED' : 'FOLLOW LIVE'}
      </button>
      <button className="btn px-2 py-1 text-3xs" onClick={onClear}>
        <Trash2 size={10} /> CLEAR VIEW
      </button>
    </div>
  );
}

function Topology({
  robots,
  records,
  now,
  selectedRobot,
  selectedPair,
  selectedMessageId,
  onSelectRobot,
  onSelectMessage,
  onSelectPair,
}: {
  robots: RobotState[];
  records: CommsRecord[];
  now: number;
  selectedRobot: string | null;
  selectedPair: { a: string; b: string } | null;
  selectedMessageId: string | null;
  onSelectRobot: (id: string) => void;
  onSelectMessage: (id: string) => void;
  onSelectPair: (pair: { a: string; b: string }) => void;
}) {
  const W = 960;
  const H = 460;
  const pad = 58;
  const robotIds = useMemo(() => new Set(robots.map((r) => r.id)), [robots]);
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; robot: RobotState }>();
    for (const r of robots) {
      map.set(r.id, {
        x: pad + (r.pose.x / WORLD_W) * (W - pad * 2),
        y: pad + (r.pose.y / WORLD_H) * (H - pad * 2),
        robot: r,
      });
    }
    return map;
  }, [robots]);

  const links = useMemo(() => {
    const map = new Map<string, { a: string; b: string; count: number; latest: CommsRecord; dropped: number }>();
    for (const r of records.slice(-120)) {
      if (!robotIds.has(r.from)) continue;
      for (const to of recipientsOf(r)) {
        if (!robotIds.has(to) || to === r.from) continue;
        const key = [r.from, to].sort().join('|');
        const prev = map.get(key);
        map.set(key, {
          a: r.from,
          b: to,
          count: (prev?.count ?? 0) + 1,
          latest: r,
          dropped: (prev?.dropped ?? 0) + (r.droppedFor.includes(to) ? 1 : 0),
        });
      }
    }
    return [...map.values()];
  }, [records, robotIds]);

  const livePackets = records
    .filter((r) => now - r.at <= 3 && robotIds.has(r.from))
    .flatMap((r) => recipientsOf(r).filter((to) => robotIds.has(to) && to !== r.from).map((to) => ({ record: r, to })));

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.06),transparent_58%)]">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <rect x={pad} y={pad} width={W - pad * 2} height={H - pad * 2} fill="#080C11" stroke="#1D2937" strokeWidth="1" />
        <g opacity="0.18">
          {Array.from({ length: 9 }, (_, i) => (
            <line key={`gx-${i}`} x1={pad + i * ((W - pad * 2) / 8)} y1={pad} x2={pad + i * ((W - pad * 2) / 8)} y2={H - pad} stroke="#26333F" />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <line key={`gy-${i}`} x1={pad} y1={pad + i * ((H - pad * 2) / 5)} x2={W - pad} y2={pad + i * ((H - pad * 2) / 5)} stroke="#26333F" />
          ))}
        </g>

        {links.map((link) => {
          const a = positions.get(link.a);
          const b = positions.get(link.b);
          if (!a || !b) return null;
          const selected = selectedPair && [selectedPair.a, selectedPair.b].sort().join('|') === [link.a, link.b].sort().join('|');
          const related = selectedRobot === link.a || selectedRobot === link.b;
          const color = link.dropped ? '#F87171' : KIND_COLOR[link.latest.kind];
          return (
            <g key={`${link.a}-${link.b}`} onClick={() => onSelectPair({ a: link.a, b: link.b })} className="cursor-pointer">
              <title>{`${link.a} <-> ${link.b}: ${link.count} logical transmissions`}</title>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={selected ? 3 : related ? 2.2 : 1.15}
                opacity={selected || related ? 0.85 : 0.28}
                strokeDasharray={link.latest.deliveredTo.length > 1 ? '6 4' : undefined}
              />
            </g>
          );
        })}

        {livePackets.map(({ record, to }) => {
          const a = positions.get(record.from);
          const b = positions.get(to);
          if (!a || !b) return null;
          const dropped = record.droppedFor.includes(to);
          return (
            <circle key={`${record.id}-${to}`} r={dropped ? 3.2 : 2.8} fill={dropped ? '#F87171' : KIND_COLOR[record.kind]} opacity="0.95" onClick={() => onSelectMessage(record.id)}>
              <animateMotion dur="1.15s" repeatCount="indefinite" path={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} />
            </circle>
          );
        })}

        {robots.map((r) => {
          const p = positions.get(r.id);
          if (!p) return null;
          const active = records.some((rec) => now - rec.at <= 2.5 && (rec.from === r.id || rec.deliveredTo.includes(r.id) || rec.droppedFor.includes(r.id)));
          const selected = selectedRobot === r.id;
          const linkOk = r.connected && r.status !== 'OFFLINE';
          const tone = linkOk ? STATUS_TONE[r.status] ?? 'steel' : 'danger';
          const color = tone === 'ok' ? '#34D399' : tone === 'warn' ? '#FBBF24' : tone === 'danger' ? '#F87171' : tone === 'analysis' ? '#A78BFA' : tone === 'nav' ? '#38BDF8' : '#64748B';
          return (
            <g key={r.id} className="cursor-pointer" onClick={() => onSelectRobot(r.id)}>
              <title>{`${r.id} - ${r.status} - ${linkOk ? 'logical link online' : 'link offline'}`}</title>
              {active && (
                <circle cx={p.x} cy={p.y} r={28} fill="none" stroke={color} strokeWidth="1" opacity="0.35">
                  <animate attributeName="r" values="22;34;22" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.45;0;0.45" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={p.x} cy={p.y} r={selected ? 19 : 16} fill="#0B1117" stroke={selected ? '#DCE4ED' : color} strokeWidth={selected ? 2 : 1.5} />
              <circle cx={p.x} cy={p.y} r="5" fill={color} opacity={linkOk ? 0.9 : 0.5} />
              <text x={p.x} y={p.y + 30} textAnchor="middle" className="font-mono" fontSize="10" fill="#DCE4ED">{r.id}</text>
              <text x={p.x} y={p.y + 41} textAnchor="middle" className="font-mono" fontSize="7.5" fill="#6F8191">{r.status}</text>
            </g>
          );
        })}

        {records.slice(-16).filter((r) => !robotIds.has(r.from)).map((r, i) => {
          const x = r.from === 'WMS' ? 28 : W - 28;
          const y = pad + 24 + (i % 10) * 28;
          return (
            <g key={r.id} onClick={() => onSelectMessage(r.id)} className="cursor-pointer">
              <circle cx={x} cy={y} r={7} fill="#0B1117" stroke={KIND_COLOR[r.kind]} />
              <text x={x} y={y + 20} textAnchor="middle" className="font-mono" fontSize="7" fill="#6F8191">{r.from}</text>
            </g>
          );
        })}
      </svg>

      <div className="absolute bottom-2 left-3 flex flex-wrap items-center gap-2 text-3xs uppercase tracking-[0.12em] text-txt3">
        <span>Nodes use actual robot IDs and current warehouse poses.</span>
        <span>Dashed links indicate broadcast delivery records.</span>
        <span>Links are logical bus interactions, not physical Wi-Fi topology.</span>
      </div>
      {selectedMessageId && (
        <div className="absolute right-3 top-3">
          <Chip tone={KIND_TONE[records.find((r) => r.id === selectedMessageId)?.kind ?? 'STATUS'] ?? 'default'}>
            SELECTED {selectedMessageId}
          </Chip>
        </div>
      )}
    </div>
  );
}

function EventFeed({
  records,
  robotIds,
  selectedMessageId,
  onSelectMessage,
  onSelectRobot,
  feedEndRef,
}: {
  records: CommsRecord[];
  robotIds: Set<string>;
  selectedMessageId: string | null;
  onSelectMessage: (id: string) => void;
  onSelectRobot: (id: string) => void;
  feedEndRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const ordered = [...records].reverse();
  if (!ordered.length) {
    return (
      <Empty>
        No observable communication events match the current filters. The page only displays records captured by the real simulation bus.
      </Empty>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="min-w-[860px]">
        {ordered.map((r) => {
          const st = recordStatus(r);
          const selected = selectedMessageId === r.id;
          const source = sourceKind(r.from, robotIds);
          return (
            <button
              key={r.id}
              className={clsx(
                'grid w-full grid-cols-[76px_94px_130px_112px_minmax(220px,1fr)_86px] items-center gap-2 border-b border-line/60 px-3 py-2 text-left transition-colors hover:bg-panel2/60',
                selected && 'bg-nav/[0.08] outline outline-1 outline-nav/35',
              )}
              onClick={() => onSelectMessage(r.id)}
            >
              <span className="mono text-[11px] text-txt3">{fmtTime(r.at)}</span>
              <span className="flex items-center gap-1.5 mono text-[11px] text-txt">
                <ArrowUpRight size={10} className={source === 'robot' ? 'text-nav' : 'text-analysis'} />
                <span onClick={(e) => { e.stopPropagation(); if (robotIds.has(r.from)) onSelectRobot(r.from); }}>{r.from}</span>
              </span>
              <span className="mono truncate text-[11px] text-txt2" title={recipientsOf(r).join(', ') || 'Pending'}>
                {r.deliveredTo.length > 1 ? `BROADCAST ${r.deliveredTo.length}` : r.deliveredTo[0] ?? r.droppedFor[0] ?? 'PENDING'}
              </span>
              <span>
                <Chip tone={KIND_TONE[r.kind]}>{categoryLabel(r.kind)}</Chip>
              </span>
              <span className="truncate text-[11px] text-txt2" title={payloadSummary(r.payload)}>{r.summary}</span>
              <span className="justify-self-end">
                <Chip tone={REC_STATUS_TONE[st]}>
                  <Dot tone={REC_STATUS_TONE[st]} />
                  {st}
                </Chip>
              </span>
            </button>
          );
        })}
      </div>
      <div ref={feedEndRef} />
    </div>
  );
}

function MessageInspector({ record, robots }: { record: CommsRecord | null; robots: RobotState[] }) {
  const robotIds = useMemo(() => new Set(robots.map((r) => r.id)), [robots]);
  if (!record) {
    return (
      <Panel dense className="min-h-0" title={<span className="flex items-center gap-2"><Brackets size={12} className="text-txt3" /> Message Inspector</span>}>
        <Empty>Select a communication event to inspect its real payload, recipients and delivery result.</Empty>
      </Panel>
    );
  }
  const st = recordStatus(record);
  const payload = JSON.stringify(record.payload, null, 2);
  const source = sourceKind(record.from, robotIds);
  const firstDelivery = Object.values(record.deliveredAt).sort((a, b) => a - b)[0] ?? null;
  const latency = firstDelivery == null ? null : firstDelivery - record.at;

  return (
    <Panel dense className="min-h-0" title={<span className="flex items-center gap-2"><Brackets size={12} className="text-txt3" /> Message Inspector</span>}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={KIND_TONE[record.kind]}>{categoryLabel(record.kind)}</Chip>
            <Chip tone={REC_STATUS_TONE[st]}>{st}</Chip>
            <Chip tone={source === 'robot' ? 'nav' : 'analysis'}>{source.toUpperCase()}</Chip>
          </div>
          <div className="mt-2">
            <KV k="MESSAGE ID" v={record.id} />
            <KV k="SENDER" v={record.from} tone={source === 'robot' ? 'nav' : 'analysis'} />
            <KV k="RECIPIENTS" v={recipientsOf(record).join(', ') || 'Not available'} />
            <KV k="CREATED" v={`${record.at.toFixed(2)}s`} />
            <KV k="FIRST DELIVERY" v={firstDelivery == null ? 'Not available' : `${firstDelivery.toFixed(2)}s`} />
            <KV k="OBSERVED LATENCY" v={latency == null ? 'Not available' : `${(latency * 1000).toFixed(0)}ms`} />
            <KV k="RELATED TASK" v={record.taskId ?? 'Not available'} tone={record.taskId ? 'nav' : 'default'} />
            <KV k="DROPPED FOR" v={record.droppedFor.join(', ') || 'None observed'} tone={record.droppedFor.length ? 'danger' : 'ok'} />
          </div>
        </div>
        <div className="border-b border-line px-3 py-2">
          <div className="label mb-1">Payload Summary</div>
          <div className="text-[11px] leading-relaxed text-txt2">{payloadSummary(record.payload)}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <pre className="mono whitespace-pre-wrap rounded border border-line2 bg-abyss/80 p-2 text-[10px] leading-relaxed text-txt2">{payload}</pre>
        </div>
      </div>
    </Panel>
  );
}

function RobotProfile({
  robotId,
  robots,
  records,
  onSelectRobot,
}: {
  robotId: string | null;
  robots: RobotState[];
  records: CommsRecord[];
  onSelectRobot: (id: string | null) => void;
}) {
  const robot = robotId ? robots.find((r) => r.id === robotId) ?? null : null;
  const robotIds = useMemo(() => new Set(robots.map((r) => r.id)), [robots]);
  const profiles = useMemo(() => {
    const sent = new Map<string, number>();
    const received = new Map<string, number>();
    const peers = new Map<string, Map<string, number>>();
    for (const r of records) {
      if (robotIds.has(r.from)) sent.set(r.from, (sent.get(r.from) ?? 0) + 1);
      for (const to of recipientsOf(r)) {
        if (!robotIds.has(to)) continue;
        received.set(to, (received.get(to) ?? 0) + 1);
        if (robotIds.has(r.from) && r.from !== to) {
          const map = peers.get(r.from) ?? new Map<string, number>();
          map.set(to, (map.get(to) ?? 0) + 1);
          peers.set(r.from, map);
          const back = peers.get(to) ?? new Map<string, number>();
          back.set(r.from, (back.get(r.from) ?? 0) + 1);
          peers.set(to, back);
        }
      }
    }
    return { sent, received, peers };
  }, [records, robotIds]);

  if (!robot) {
    return (
      <Panel dense className="min-h-0" title={<span className="flex items-center gap-2"><Radio size={12} className="text-txt3" /> Robot Communication Profile</span>}>
        <div className="min-h-0 overflow-y-auto p-2">
          {robots.map((r) => (
            <button key={r.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-panel2/60" onClick={() => onSelectRobot(r.id)}>
              <Dot tone={r.connected && r.status !== 'OFFLINE' ? STATUS_TONE[r.status] ?? 'steel' : 'danger'} pulse={r.status === 'MOVING'} />
              <span className="mono w-10 text-[11px] font-semibold text-txt">{r.id}</span>
              <span className="truncate text-3xs uppercase tracking-[0.1em] text-txt3">{r.status}</span>
              <span className="mono ml-auto text-3xs text-txt3">{(profiles.sent.get(r.id) ?? 0) + (profiles.received.get(r.id) ?? 0)} msg</span>
            </button>
          ))}
        </div>
      </Panel>
    );
  }

  const involved = [...records].reverse().filter((r) => r.from === robot.id || recipientsOf(r).includes(robot.id));
  const peers = [...(profiles.peers.get(robot.id) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const latestIntent = involved.find((r) => r.kind === 'INTENT' && r.from === robot.id);

  return (
    <Panel
      dense
      className="min-h-0"
      title={<span className="flex items-center gap-2"><Radio size={12} className="text-txt3" /> {robot.id} Profile</span>}
      right={<button className="btn-icon" onClick={() => onSelectRobot(null)} title="Return to complete network">x</button>}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-line px-3 py-2">
          <div className="flex items-center gap-2">
            <Chip tone={robot.connected && robot.status !== 'OFFLINE' ? STATUS_TONE[robot.status] ?? 'steel' : 'danger'}>
              <Dot tone={robot.connected && robot.status !== 'OFFLINE' ? STATUS_TONE[robot.status] ?? 'steel' : 'danger'} />
              {robot.status}
            </Chip>
            <Chip tone={robot.executionMode === 'PHYSICAL' ? 'ok' : 'steel'}>{robot.executionMode}</Chip>
          </div>
          <div className="mt-2">
            <KV k="TASK" v={robot.taskId ?? 'Not available'} tone={robot.taskId ? 'nav' : 'default'} />
            <KV k="NAV INTENT" v={latestIntent ? payloadSummary(latestIntent.payload) : 'Not available'} />
            <KV k="LATENCY" v={`${robot.latencyMs.toFixed(0)}ms`} />
            <KV k="PACKET LOSS" v={`${robot.packetLoss.toFixed(2)}%`} tone={robot.packetLoss > 2 ? 'warn' : 'default'} />
            <KV k="SENT" v={profiles.sent.get(robot.id) ?? 0} tone="nav" />
            <KV k="RECEIVED" v={profiles.received.get(robot.id) ?? 0} tone="ok" />
          </div>
        </div>
        <div className="shrink-0 border-b border-line px-3 py-2">
          <div className="label mb-1.5">Most Frequent Logical Peers</div>
          {peers.length ? peers.map(([id, count]) => (
            <button key={id} className="flex w-full items-center gap-2 rounded px-1 py-1 hover:bg-panel2/60" onClick={() => onSelectRobot(id)}>
              <span className="mono text-[11px] text-txt">{id}</span>
              <span className="h-px flex-1 bg-line2" />
              <span className="mono text-3xs text-txt3">{count}</span>
            </button>
          )) : <div className="text-3xs text-txt3">No robot-to-robot interactions observed yet.</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {involved.slice(0, 18).map((r) => {
            const outgoing = r.from === robot.id;
            return (
              <div key={r.id} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-panel2/50">
                <span className={clsx('mt-[3px]', outgoing ? 'text-nav' : r.droppedFor.includes(robot.id) ? 'text-danger' : 'text-ok')}>
                  {outgoing ? <ArrowUpRight size={10} /> : r.droppedFor.includes(robot.id) ? <WifiOff size={10} /> : <ArrowDownLeft size={10} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="mono text-3xs text-txt3">{fmtTime(r.at)}</span>
                    <Chip tone={KIND_TONE[r.kind]}>{categoryLabel(r.kind)}</Chip>
                  </div>
                  <div className="truncate text-3xs text-txt2">{r.summary}</div>
                </div>
              </div>
            );
          })}
          {!involved.length && <Empty>No traffic for this robot in the visible bus log.</Empty>}
        </div>
      </div>
    </Panel>
  );
}

function Analytics({ robots, records, now }: { robots: RobotState[]; records: CommsRecord[]; now: number }) {
  const robotIds = useMemo(() => new Set(robots.map((r) => r.id)), [robots]);
  const buckets = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => {
      const hi = now - (23 - i) * 2;
      const lo = hi - 2;
      return records.filter((r) => r.at >= lo && r.at < hi).length;
    });
  }, [now, records]);
  const categoryCounts = useMemo(() => {
    const map = new Map<Message['kind'], number>();
    for (const r of records) map.set(r.kind, (map.get(r.kind) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [records]);
  const volumes = useMemo(() => {
    return robots.map((r) => {
      const sent = records.filter((m) => m.from === r.id).length;
      const received = records.filter((m) => m.deliveredTo.includes(r.id)).length;
      const dropped = records.filter((m) => m.droppedFor.includes(r.id)).length;
      return { id: r.id, sent, received, dropped, total: sent + received + dropped };
    }).sort((a, b) => b.total - a.total);
  }, [records, robots]);
  const robotToRobot = records.filter((r) => robotIds.has(r.from) && recipientsOf(r).some((to) => robotIds.has(to))).length;

  return (
    <Panel dense className="min-h-0" title={<span className="flex items-center gap-2"><Activity size={12} className="text-txt3" /> Communication Analytics</span>}>
      <div className="flex h-full min-h-0 flex-col gap-2 p-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="VOLUME" value={records.length} tone="nav" />
          <Stat label="ROBOT MESH" value={robotToRobot} tone="analysis" />
          <Stat label="DROPS" value={records.reduce((n, r) => n + r.droppedFor.length, 0)} tone={records.some((r) => r.droppedFor.length) ? 'danger' : 'ok'} />
        </div>
        <div className="rounded border border-line2 bg-abyss/50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="label">Message Volume</span>
            <Gauge size={11} className="text-txt3" />
          </div>
          <Sparkline data={buckets} width={300} height={38} color="#38BDF8" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
          <div className="min-h-0 overflow-y-auto rounded border border-line2 bg-abyss/50 p-2">
            <div className="label mb-1.5">Category Distribution</div>
            {categoryCounts.map(([kind, count]) => (
              <div key={kind} className="mb-1.5">
                <div className="mb-1 flex justify-between gap-2 text-3xs">
                  <span className="truncate text-txt2">{categoryLabel(kind)}</span>
                  <span className="mono text-txt3">{count}</span>
                </div>
                <div className="h-1 overflow-hidden rounded bg-line2">
                  <div className="h-full rounded" style={{ width: `${Math.min(100, (count / Math.max(1, records.length)) * 100)}%`, background: KIND_COLOR[kind] }} />
                </div>
              </div>
            ))}
            {!categoryCounts.length && <div className="text-3xs text-txt3">No categorized traffic yet.</div>}
          </div>
          <div className="min-h-0 overflow-y-auto rounded border border-line2 bg-abyss/50 p-2">
            <div className="label mb-1.5">Per-Robot Volume</div>
            {volumes.map((v) => {
              const max = Math.max(1, v.total);
              return (
                <div key={v.id} className="mb-1.5">
                  <div className="mb-1 flex justify-between gap-2 text-3xs">
                    <span className="mono text-txt2">{v.id}</span>
                    <span className="mono text-txt3">{v.total}</span>
                  </div>
                  <div className="flex h-1 overflow-hidden rounded bg-line2">
                    <span className="bg-nav" style={{ width: `${(v.sent / max) * 100}%` }} />
                    <span className="bg-ok" style={{ width: `${(v.received / max) * 100}%` }} />
                    <span className="bg-danger" style={{ width: `${(v.dropped / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3 text-3xs uppercase tracking-[0.12em] text-txt3">
          <span className="flex items-center gap-1"><Signal size={10} className="text-nav" /> sent</span>
          <span className="flex items-center gap-1"><Clock size={10} className="text-ok" /> received</span>
          <span className="flex items-center gap-1"><WifiOff size={10} className="text-danger" /> dropped</span>
        </div>
      </div>
    </Panel>
  );
}
