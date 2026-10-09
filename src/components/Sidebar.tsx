import clsx from 'clsx';
import {
  Activity,
  Cpu,
  FlaskConical,
  ListChecks,
  Radar,
  Radio,
  Server,
  TrafficCone,
} from 'lucide-react';
import { useNexus, type PageId } from '@/store/useNexus';
import { Dot } from './ui';

const NAV: { id: PageId; label: string; sub: string; icon: typeof Radar }[] = [
  { id: 'COMMAND', label: 'COMMAND CENTER', sub: 'LIVE OPERATIONS', icon: Radar },
  { id: 'FLEET', label: 'FLEET', sub: 'AGENT REGISTRY', icon: Cpu },
  { id: 'TASKS', label: 'TASKS', sub: 'ALLOCATION LEDGER', icon: ListChecks },
  { id: 'TRAFFIC', label: 'TRAFFIC', sub: 'CONFLICT + FLOW', icon: TrafficCone },
  { id: 'TWIN', label: 'DIGITAL TWIN', sub: 'PHYSICAL BRIDGE', icon: Radio },
  { id: 'EXPERIMENTS', label: 'EXPERIMENTS', sub: 'CONTROLLED TRIALS', icon: FlaskConical },
  { id: 'SYSTEM', label: 'SYSTEM', sub: 'NODE HEALTH', icon: Server },
];

export function Sidebar() {
  const page = useNexus((s) => s.page);
  const setPage = useNexus((s) => s.setPage);
  const snap = useNexus((s) => s.snap);

  const offline = snap.nodes.filter((n) => n.status === 'OFFLINE').length;
  const degraded = snap.nodes.filter((n) => n.status === 'DEGRADED').length;
  const healthy = offline === 0 && degraded === 0;

  return (
    <aside className="flex w-[196px] shrink-0 flex-col border-r border-line bg-abyss">
      {/* ── brand ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-line px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2.5">
          <NexusMark />
          <div className="min-w-0">
            <div className="font-['Manrope'] text-[19px] font-extrabold leading-none tracking-[0.16em] text-txt">
              NEXUS
            </div>
            <div className="mt-1 text-3xs font-semibold uppercase leading-tight tracking-[0.1em] text-txt3">
              Autonomous Warehouse
            </div>
          </div>
        </div>
        <div className="mt-2.5 border-t border-line pt-2 text-3xs leading-relaxed text-txt3">
          Decentralized multi-agent
          <br />
          coordination + digital twin
        </div>
      </div>

      {/* ── nav ───────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = page === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={clsx(
                'group relative flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors',
                active ? 'bg-nav/[0.08]' : 'hover:bg-panel2/50',
              )}
            >
              {active && <span className="absolute left-0 top-0 h-full w-[2px] bg-nav" />}
              <Icon
                size={14}
                className={clsx('shrink-0 transition-colors', active ? 'text-nav' : 'text-txt3 group-hover:text-txt2')}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={clsx(
                    'block text-[11px] font-semibold uppercase tracking-[0.1em]',
                    active ? 'text-txt' : 'text-txt2',
                  )}
                >
                  {n.label}
                </span>
                <span className="block text-3xs tracking-[0.08em] text-txt3">{n.sub}</span>
              </span>
            </button>
          );
        })}
      </nav>

      {/* ── system strip ──────────────────────────────────────────────────── */}
      <div className="border-t border-line px-4 py-2.5">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Dot tone={healthy ? 'ok' : offline > 0 ? 'danger' : 'warn'} pulse={!healthy} />
          <span className="text-3xs font-semibold uppercase tracking-[0.12em] text-txt3">
            {healthy ? 'ALL SYSTEMS NOMINAL' : `${degraded} DEGRADED · ${offline} OFFLINE`}
          </span>
        </div>
        <div className="flex items-center gap-3 text-3xs text-txt3">
          <span className="flex items-center gap-1">
            <Activity size={10} />
            {(1000 / 100).toFixed(0)}
          </span>
          <span className="mono">{snap.fleet.activeRobots}/{snap.robots.length} ONLINE</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-3xs text-txt3">
          <span className="mono">BUILD 2.4.1</span>
          <span className="mono">SIM {snap.tick}</span>
        </div>
      </div>
    </aside>
  );
}

/** NEXUS mark: a coordination lattice — network + robot + twin, no clichés. */
function NexusMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" className="shrink-0">
      <rect x="0.6" y="0.6" width="24.8" height="24.8" rx="4" stroke="#26333F" />
      <path d="M5 19 L13 4 L21 19" stroke="#38BDF8" strokeWidth="1.1" strokeLinejoin="round" opacity="0.5" />
      <path d="M5 19 H21" stroke="#38BDF8" strokeWidth="1.1" opacity="0.5" />
      <circle cx="13" cy="4" r="2.1" fill="#38BDF8" />
      <circle cx="5" cy="19" r="1.7" fill="#34D399" />
      <circle cx="21" cy="19" r="1.7" fill="#34D399" />
      <circle cx="13" cy="19" r="1.4" fill="#A78BFA" />
      <path d="M13 6.1 V16.9" stroke="#A78BFA" strokeWidth="0.9" opacity="0.65" />
    </svg>
  );
}
