import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowDownLeft, ArrowUpRight, Inbox, Network, Radio, Send, WifiOff } from 'lucide-react';
import { useNexus } from '@/store/useNexus';
import { Chip, Dot, Empty, KV, Panel, Segmented, Stat, type Tone } from '@/components/ui';
import type { CommsRecord } from '@/simulation/communication/bus';
import type { RobotState } from '@/simulation/types';

const STATUS_COLOR: Record<string, string> = {
  IDLE: '#8091A3',
  MOVING: '#38BDF8',
  WAITING: '#FBBF24',
  PICKING: '#38BDF8',
  DROPPING: '#38BDF8',
  CHARGING: '#34D399',
  REROUTING: '#A78BFA',
  BLOCKED: '#EF4444',
  DEGRADED: '#FBBF24',
  OFFLINE: '#EF4444',
  ESTOP: '#EF4444',
  BINDING: '#A78BFA',
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

const KIND_TONE: Record<string, Tone> = {
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

type RecStatus = 'DELIVERED' | 'PARTIAL' | 'DROPPED' | 'PENDING';

function recordStatus(r: CommsRecord): RecStatus {
  const rx = r.deliveredTo.length;
  const dr = r.droppedFor.length;
  if (!rx && !dr) return 'PENDING';
  if (rx && !dr) return 'DELIVERED';
  if (rx && dr) return 'PARTIAL';
  return 'DROPPED';
}

const REC_STATUS_TONE: Record<RecStatus, Tone> = {
  DELIVERED: 'ok',
  PARTIAL: 'warn',
  DROPPED: 'danger',
  PENDING: 'steel',
};

export function Communication() {
  const snap = useNexus((s) => s.snap);
  const robots = snap.robots;
  const records = snap.comms;

  const [selected, setSelected] = useState<string | null>(null);
  const [robotFilter, setRobotFilter] = useState<string>('ALL');
  const [direction, setDirection] = useState<'ALL' | 'SENT' | 'RECEIVED'>('ALL');
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [onlyTask, setOnlyTask] = useState(false);

  const robotIds = useMemo(() => new Set(robots.map((r) => r.id)), [robots]);

  const connected = robots.filter((r) => r.connected && r.status !== 'OFFLINE');
  const disconnected = robots.filter((r) => !r.connected || r.status === 'OFFLINE');
  const recent = records.filter((r) => snap.time - r.at <= 10);

  const filtered = useMemo(() => {
    let list = records;
    if (robotFilter !== 'ALL') {
      list = list.filter(
        (r) => r.from === robotFilter || r.deliveredTo.includes(robotFilter) || r.droppedFor.includes(robotFilter),
      );
    }
    if (direction === 'SENT') {
      list = list.filter((r) => (robotFilter === 'ALL' ? robotIds.has(r.from) : r.from === robotFilter));
    } else if (direction === 'RECEIVED') {
      list = list.filter((r) =>
        robotFilter === 'ALL'
          ? r.deliveredTo.length + r.droppedFor.length > 0
          : r.deliveredTo.includes(robotFilter) || r.droppedFor.includes(robotFilter),
      );
    }
    if (onlyFailed) list = list.filter((r) => r.droppedFor.length > 0);
    if (onlyTask) list = list.filter((r) => !!r.taskId);
    return [...list].reverse();
  }, [records, robotFilter, direction, onlyFailed, onlyTask, robotIds]);

  const latest = records.length ? records[records.length - 1] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 bg-void p-3">
      {/* ── summary ─────────────────────────────────────────────────────────── */}
      <div className="grid shrink-0 grid-cols-6 gap-3">
        <div className="panel p-3"><Stat label="ACTIVE LINKS" value={`${connected.length}/${robots.length}`} tone="nav" hint="hub ↔ robot channels" /></div>
        <div className="panel p-3"><Stat label="DISCONNECTED" value={`${disconnected.length}`} tone={disconnected.length ? 'danger' : 'ok'} hint={disconnected.length ? 'confirmed link loss' : 'all links healthy'} /></div>
        <div className="panel p-3"><Stat label="MESSAGES SENT" value={`${snap.commsStats.sent}`} tone="default" /></div>
        <div className="panel p-3"><Stat label="DELIVERED" value={`${snap.commsStats.delivered}`} tone="ok" /></div>
        <div className="panel p-3"><Stat label="DROPPED" value={`${snap.commsStats.dropped}`} tone={snap.commsStats.dropped ? 'danger' : 'ok'} /></div>
        <div className="panel p-3"><Stat label="RECENT · 10s" value={`${recent.length}`} tone="analysis" hint="events on the wire" /></div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* ── network topology ──────────────────────────────────────────── */}
          <Panel
            className="min-h-0 flex-[1.35]"
            dense
            title={
              <span className="flex items-center gap-2">
                <Network size={12} className="text-txt3" />
                COMMUNICATION NETWORK
              </span>
            }
            right={
              <span className="flex items-center gap-2 text-3xs uppercase tracking-[0.1em] text-txt3">
                <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded-full bg-nav/70" /> ACTIVE</span>
                <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded-full bg-[#38BDF8]/20" /> IDLE</span>
                <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-4 rounded-full bg-danger/70" /> LOST</span>
              </span>
            }
          >
            <NetworkDiagram
              robots={robots}
              records={records}
              now={snap.time}
              selected={selected}
              onSelect={setSelected}
            />
          </Panel>

          {/* ── message history ───────────────────────────────────────────── */}
          <Panel
            className="min-h-0 flex-1"
            dense
            title={
              <span className="flex items-center gap-2">
                <Inbox size={12} className="text-txt3" />
                MESSAGE HISTORY
              </span>
            }
            right={
              latest ? (
                <span className="flex items-center gap-2 text-3xs text-txt3">
                  <Dot tone={KIND_TONE[latest.kind] ?? 'default'} />
                  <span className="mono text-txt2">{latest.from}</span>
                  <span className="truncate">{latest.summary}</span>
                </span>
              ) : undefined
            }
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <Segmented
                  size="xs"
                  value={direction}
                  onChange={setDirection}
                  options={[
                    { id: 'ALL', label: 'ALL' },
                    { id: 'SENT', label: 'SENT' },
                    { id: 'RECEIVED', label: 'RECEIVED' },
                  ]}
                />
                <button
                  onClick={() => setOnlyFailed((v) => !v)}
                  className={clsx('btn flex items-center gap-1 px-2 py-1 text-3xs', onlyFailed && 'border-danger/50 text-danger')}
                >
                  <WifiOff size={10} /> FAILED
                </button>
                <button
                  onClick={() => setOnlyTask((v) => !v)}
                  className={clsx('btn flex items-center gap-1 px-2 py-1 text-3xs', onlyTask && 'border-analysis/50 text-analysis')}
                >
                  TASK-RELATED
                </button>
                <div className="ml-auto flex max-w-[60%] items-center gap-1 overflow-x-auto">
                  <FilterChip id="ALL" label="ALL ROBOTS" active={robotFilter === 'ALL'} onClick={() => setRobotFilter('ALL')} />
                  {robots.map((r) => (
                    <FilterChip key={r.id} id={r.id} label={r.id} active={robotFilter === r.id} onClick={() => setRobotFilter(r.id)} />
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[860px]">
                  <thead className="sticky top-0 z-10 bg-panel">
                    <tr>
                      <th className="th text-left">TIME</th>
                      <th className="th text-left">FROM</th>
                      <th className="th text-left">TO</th>
                      <th className="th text-center">TYPE</th>
                      <th className="th text-left">SUMMARY</th>
                      <th className="th text-center">TASK</th>
                      <th className="th text-center">STATUS</th>
                      <th className="th text-center">DROPPED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const st = recordStatus(r);
                      const fromRobot = robotIds.has(r.from);
                      const recipients = r.deliveredTo;
                      const rxText = recipients.length
                        ? recipients.length > 3
                          ? `${recipients.length} ROBOTS`
                          : recipients.join(', ')
                        : r.droppedFor.length
                          ? `${r.droppedFor.length} LOST`
                          : '—';
                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelected(fromRobot ? r.from : recipients[0] ?? null)}
                          className="cursor-pointer border-t border-line/50 transition-colors hover:bg-panel2/60"
                        >
                          <td className="px-2 py-1.5 mono text-[11px] text-txt3">{r.at.toFixed(2)}s</td>
                          <td className="px-2 py-1.5 mono text-[11px] text-txt">{r.from}</td>
                          <td className="px-2 py-1.5 mono text-[11px] text-txt2" title={recipients.join(', ')}>{rxText}</td>
                          <td className="px-2 py-1.5 text-center">
                            <Chip tone={KIND_TONE[r.kind] ?? 'default'}>{r.kind.replace('TASK_', '')}</Chip>
                          </td>
                          <td className="max-w-[280px] truncate px-2 py-1.5 text-[11px] text-txt2" title={r.summary}>{r.summary}</td>
                          <td className="px-2 py-1.5 text-center mono text-[11px] text-txt3">{r.taskId ?? '—'}</td>
                          <td className="px-2 py-1.5 text-center">
                            <Chip tone={REC_STATUS_TONE[st]}><Dot tone={REC_STATUS_TONE[st]} />{st}</Chip>
                          </td>
                          <td className="px-2 py-1.5 text-center mono text-[11px] text-danger">{r.droppedFor.length || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!filtered.length && <Empty>NO MESSAGES MATCH THIS FILTER</Empty>}
              </div>
            </div>
          </Panel>
        </div>

        {/* ── detail ────────────────────────────────────────────────────────── */}
        <div className="w-[340px] shrink-0">
          <RobotCommsDetail
            robots={robots}
            records={records}
            now={snap.time}
            selected={selected}
            onSelect={setSelected}
            robotIds={robotIds}
          />
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'shrink-0 rounded border px-1.5 py-[2px] text-3xs font-semibold uppercase tracking-[0.08em] transition-colors',
        active ? 'border-nav/50 bg-nav/[0.16] text-nav' : 'border-line2 bg-raised/40 text-txt3 hover:text-txt2',
      )}
    >
      {label}
    </button>
  );
}

function NetworkDiagram({
  robots,
  records,
  now,
  selected,
  onSelect,
}: {
  robots: RobotState[];
  records: CommsRecord[];
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const W = 820;
  const H = 470;
  const cx = W / 2;
  const cy = H / 2 - 6;
  const R = Math.min(W, H) * 0.37;
  const n = Math.max(1, robots.length);

  const nodes = robots.map((r, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { robot: r, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
  });

  const activity = (id: string) =>
    records.some(
      (rec) =>
        now - rec.at <= 2.5 &&
        (rec.from === id || rec.deliveredTo.includes(id) || rec.droppedFor.includes(id)),
    );
  const failed = (id: string) =>
    records.some((rec) => now - rec.at <= 3.5 && rec.droppedFor.includes(id));

  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* edges */}
        {nodes.map(({ robot: r, x, y }) => {
          const linkOk = r.connected && r.status !== 'OFFLINE';
          const active = activity(r.id);
          const lost = failed(r.id);
          const isSel = selected === r.id;
          const stroke = lost ? '#EF4444' : linkOk ? (active ? '#38BDF8' : 'rgba(56,189,248,0.24)') : 'rgba(239,68,68,0.55)';
          const width = isSel ? 2.4 : active ? 1.6 : 1;
          const sentActive = records.some((rec) => now - rec.at <= 2.5 && rec.from === r.id);
          const recvActive = records.some(
            (rec) => now - rec.at <= 2.5 && (rec.deliveredTo.includes(r.id) || rec.droppedFor.includes(r.id)),
          );
          return (
            <g key={`edge-${r.id}`} className="cursor-pointer" onClick={() => onSelect(r.id)}>
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke={stroke}
                strokeWidth={width}
                strokeDasharray={linkOk ? undefined : '4 4'}
              />
              {active && recvActive && (
                <circle r={2.6} fill="#38BDF8">
                  <animateMotion dur="1s" repeatCount="indefinite" path={`M ${cx} ${cy} L ${x} ${y}`} />
                </circle>
              )}
              {active && sentActive && (
                <circle r={2.6} fill="#34D399">
                  <animateMotion dur="1s" repeatCount="indefinite" path={`M ${x} ${y} L ${cx} ${cy}`} />
                </circle>
              )}
            </g>
          );
        })}

        {/* hub */}
        <g>
          <circle cx={cx} cy={cy} r={74} fill="url(#hubGlow)" />
          <circle cx={cx} cy={cy} r={30} fill="#0B1117" stroke="#38BDF8" strokeWidth="1.4" />
          <circle cx={cx} cy={cy} r={30} fill="none" stroke="#38BDF8" strokeWidth="1" opacity="0.35">
            <animate attributeName="r" values="30;42;30" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0;0.35" dur="3s" repeatCount="indefinite" />
          </circle>
          <text x={cx} y={cy - 2} textAnchor="middle" className="font-mono" fontSize="8.5" fill="#8FB6CE" letterSpacing="1">
            COMMS
          </text>
          <text x={cx} y={cy + 7} textAnchor="middle" className="font-mono" fontSize="8.5" fill="#8FB6CE" letterSpacing="1">
            BUS
          </text>
        </g>

        {/* robot nodes */}
        {nodes.map(({ robot: r, x, y }) => {
          const linkOk = r.connected && r.status !== 'OFFLINE';
          const color = linkOk ? STATUS_COLOR[r.status] ?? '#8091A3' : '#EF4444';
          const isSel = selected === r.id;
          return (
            <g key={`node-${r.id}`} className="cursor-pointer" onClick={() => onSelect(r.id)}>
              <title>{`${r.id} · ${r.status} · ${linkOk ? 'LINK OK' : 'NO LINK'}`}</title>
              {isSel && <circle cx={x} cy={y} r={21} fill="none" stroke="#38BDF8" strokeWidth="1.2" />}
              <circle cx={x} cy={y} r={14} fill="#0B1117" stroke={color} strokeWidth="1.6" />
              <circle cx={x} cy={y} r={4.5} fill={color} opacity={r.status === 'MOVING' ? 1 : 0.7}>
                {r.status === 'MOVING' && <animate attributeName="opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite" />}
              </circle>
              {!linkOk && (
                <g transform={`translate(${x + 9}, ${y - 17})`}>
                  <circle r={6} fill="#0B1117" stroke="#EF4444" strokeWidth="1" />
                  <path d="M-2.4 -2.4 L2.4 2.4 M2.4 -2.4 L-2.4 2.4" stroke="#EF4444" strokeWidth="1.1" />
                </g>
              )}
              <text x={x} y={y + 26} textAnchor="middle" className="font-mono" fontSize="9.5" fill="#C3D0DA">
                {r.id}
              </text>
              <text x={x} y={y + 36} textAnchor="middle" className="font-mono" fontSize="7.5" fill="#5E7183">
                {r.status}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute bottom-2 left-3 text-3xs uppercase tracking-[0.12em] text-txt3">
        STAR TOPOLOGY · CENTRAL COMMS BUS · CLICK A NODE OR LINK FOR DETAIL
      </div>
    </div>
  );
}

function RobotCommsDetail({
  robots,
  records,
  now,
  selected,
  onSelect,
  robotIds,
}: {
  robots: RobotState[];
  records: CommsRecord[];
  now: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  robotIds: Set<string>;
}) {
  const robot = selected ? robots.find((r) => r.id === selected) : null;

  const stats = useMemo(() => {
    const sent = new Map<string, number>();
    const recv = new Map<string, number>();
    const lost = new Map<string, number>();
    const lastOk = new Map<string, number>();
    for (const r of records) {
      sent.set(r.from, (sent.get(r.from) ?? 0) + 1);
      for (const id of r.deliveredTo) {
        recv.set(id, (recv.get(id) ?? 0) + 1);
        lastOk.set(id, r.at);
      }
      for (const id of r.droppedFor) lost.set(id, (lost.get(id) ?? 0) + 1);
    }
    return { sent, recv, lost, lastOk };
  }, [records]);

  if (!robot) {
    return (
      <Panel className="h-full" dense title={<span className="flex items-center gap-2"><Radio size={12} className="text-txt3" /> ROBOT COMMUNICATION</span>}>
        <div className="flex h-full flex-col">
          <div className="border-b border-line px-3 py-2 text-3xs leading-relaxed text-txt3">
            Link health is read directly from the simulation channel model (latency, packet loss and
            connection state per robot). Select a robot or a link to inspect its traffic, delivery
            outcomes and errors.
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
            {robots.map((r) => {
              const linkOk = r.connected && r.status !== 'OFFLINE';
              const last = stats.lastOk.get(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => onSelect(r.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-panel2/60"
                >
                  <Dot tone={linkOk ? STATUS_TONE[r.status] ?? 'steel' : 'danger'} pulse={r.status === 'MOVING'} />
                  <span className="mono w-8 shrink-0 text-[11px] font-semibold text-txt">{r.id}</span>
                  <span className="w-[78px] shrink-0 truncate text-3xs uppercase tracking-[0.08em] text-txt2">{r.status}</span>
                  <span className={clsx('mono ml-auto shrink-0 text-3xs', linkOk ? 'text-txt3' : 'text-danger')}>
                    {linkOk ? (last != null ? `${(now - last).toFixed(1)}s` : 'IDLE') : 'NO LINK'}
                  </span>
                </button>
              );
            })}
            {!robots.length && <Empty>NO ROBOTS REGISTERED</Empty>}
          </div>
        </div>
      </Panel>
    );
  }

  const linkOk = robot.connected && robot.status !== 'OFFLINE';
  const sent = stats.sent.get(robot.id) ?? 0;
  const recv = stats.recv.get(robot.id) ?? 0;
  const lost = stats.lost.get(robot.id) ?? 0;
  const last = stats.lastOk.get(robot.id);
  const involved = [...records].reverse().filter(
    (r) => r.from === robot.id || r.deliveredTo.includes(robot.id) || r.droppedFor.includes(robot.id),
  );
  const errors = involved.filter((r) => r.droppedFor.includes(robot.id));

  const peer = (rec: CommsRecord) => {
    if (rec.from === robot.id) {
      const ids = rec.deliveredTo.length ? rec.deliveredTo : rec.droppedFor;
      return ids.length > 1 ? `FLEET (${ids.length})` : ids[0] ?? 'BUS';
    }
    return robotIds.has(rec.from) ? rec.from : 'COMMS BUS';
  };

  return (
    <Panel
      className="h-full"
      dense
      title={<span className="flex items-center gap-2"><Radio size={12} className="text-txt3" /> {robot.id} · COMMUNICATION</span>}
      right={<button className="btn-icon" onClick={() => onSelect(null)} title="Clear selection">×</button>}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-line px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Chip tone={linkOk ? STATUS_TONE[robot.status] ?? 'steel' : 'danger'}>
              <Dot tone={linkOk ? STATUS_TONE[robot.status] ?? 'steel' : 'danger'} pulse={robot.status === 'MOVING'} />
              {linkOk ? 'LINK ESTABLISHED' : 'DISCONNECTED'}
            </Chip>
            <Chip tone={robot.executionMode === 'PHYSICAL' ? 'ok' : 'steel'}>
              {robot.executionMode === 'PHYSICAL' ? 'PHYSICAL' : 'SIMULATED'}
            </Chip>
          </div>
          <div className="mt-2 space-y-0">
            <KV k="OPERATIONAL STATUS" v={robot.status} tone={STATUS_TONE[robot.status] ?? 'default'} />
            <KV k="LINK STATE" v={linkOk ? 'ONLINE' : 'NO LINK'} tone={linkOk ? 'ok' : 'danger'} />
            <KV k="BOUND HARDWARE" v={robot.hardwareId ?? '—'} />
            <KV k="CHANNEL LATENCY" v={`${robot.latencyMs.toFixed(0)} ms`} tone={robot.latencyMs > 80 ? 'warn' : 'default'} />
            <KV k="PACKET LOSS" v={`${(robot.packetLoss * 100).toFixed(1)} %`} tone={robot.packetLoss > 0.15 ? 'danger' : robot.packetLoss > 0.05 ? 'warn' : 'ok'} />
            <KV k="LAST HEARTBEAT" v={`${(now - robot.lastHeartbeat).toFixed(1)} s AGO`} />
            <KV k="LAST SUCCESSFUL RX" v={last != null ? `${(now - last).toFixed(1)} s AGO` : '—'} tone={last != null ? 'default' : 'warn'} />
            <KV k="ACTIVE TASK" v={robot.taskId ?? '—'} tone="nav" />
            <KV k="ROUTE DESTINATION" v={robot.destinationLabel ?? '—'} />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded border border-line2 bg-abyss/50 px-2.5 py-2">
            <Stat label="SENT" value={`${sent}`} tone="nav" />
            <Stat label="RECEIVED" value={`${recv}`} tone="ok" />
            <Stat label="LOST" value={`${lost}`} tone={lost ? 'danger' : 'ok'} />
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <Send size={10} className="text-txt3" />
          <span className="label">RECENT MESSAGES</span>
          {errors.length > 0 && <Chip tone="danger" className="ml-auto">{errors.length} ERRORS</Chip>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {involved.slice(0, 24).map((r) => {
            const outgoing = r.from === robot.id;
            const dropped = r.droppedFor.includes(robot.id);
            return (
              <div key={r.id} className="flex items-start gap-2 rounded px-1.5 py-1 hover:bg-panel2/50">
                <span className={clsx('mt-[3px] shrink-0', dropped ? 'text-danger' : outgoing ? 'text-nav' : 'text-ok')}>
                  {dropped ? <WifiOff size={10} /> : outgoing ? <ArrowUpRight size={10} /> : <ArrowDownLeft size={10} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="mono text-3xs text-txt3">{r.at.toFixed(2)}s</span>
                    <Chip tone={KIND_TONE[r.kind] ?? 'default'}>{r.kind.replace('TASK_', '')}</Chip>
                    <span className="mono ml-auto truncate text-3xs text-txt3">{outgoing ? 'TX' : 'RX'} · {peer(r)}</span>
                  </div>
                  <div className="truncate text-3xs text-txt2" title={r.summary}>{r.summary}</div>
                </div>
              </div>
            );
          })}
          {!involved.length && <Empty>NO TRAFFIC FOR THIS ROBOT YET</Empty>}
        </div>
      </div>
    </Panel>
  );
}
