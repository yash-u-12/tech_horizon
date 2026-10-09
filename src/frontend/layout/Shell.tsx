import { useEffect } from 'react'
import {
  Activity,
  Boxes,
  Cpu,
  FlaskConical,
  Gauge,
  GitBranch,
  ListChecks,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Network,
} from 'lucide-react'
import { useNexus, type Page } from '../../store/useNexus'
import { Chip, Dot, SegmentedControl } from '../../components/ui'

const PAGES: { id: Page; label: string; icon: typeof Gauge; hint: string }[] = [
  { id: 'COMMAND', label: 'COMMAND', icon: Gauge, hint: 'Live warehouse command centre' },
  { id: 'FLEET', label: 'FLEET', icon: Boxes, hint: 'Agents, execution modes and bindings' },
  { id: 'TASKS', label: 'TASKS', icon: ListChecks, hint: 'Task lifecycle and allocation reasoning' },
  { id: 'TRAFFIC', label: 'TRAFFIC', icon: GitBranch, hint: 'Conflicts, congestion, right-of-way' },
  { id: 'TWIN', label: 'TWIN', icon: Network, hint: 'Physical robots and digital twins' },
  { id: 'EXPERIMENTS', label: 'EXPERIMENTS', icon: FlaskConical, hint: 'Controlled scenarios and metrics' },
  { id: 'SYSTEM', label: 'SYSTEM', icon: Cpu, hint: 'Runtime, mesh and robot gateway' },
]

export function NavRail() {
  const page = useNexus((s) => s.page)
  const setPage = useNexus((s) => s.setPage)
  const alerts = useNexus((s) => s.snapshot.events.filter((e) => e.level === 'CRITICAL').length)
  return (
    <nav className="flex w-[62px] shrink-0 flex-col items-center gap-1 border-r border-nx-line bg-nx-base py-2">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded border border-nx-cyan/30 bg-nx-cyan/10">
        <NexusMark />
      </div>
      {PAGES.map((p) => {
        const Icon = p.icon
        const active = page === p.id
        return (
          <button
            key={p.id}
            title={p.hint}
            aria-label={p.id}
            aria-current={active ? 'page' : undefined}
            onClick={() => setPage(p.id)}
            className={`group relative flex w-[54px] flex-col items-center gap-1 rounded px-1 py-2 transition-colors ${
              active ? 'bg-nx-line/60 text-nx-cyan' : 'text-nx-faint hover:bg-nx-line/30 hover:text-nx-dim'
            }`}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-nx-cyan" />}
            <Icon size={16} strokeWidth={1.75} />
            <span className="font-mono text-[8px] font-medium tracking-[0.06em]">{p.label.length > 9 ? p.label.slice(0, 7) : p.label}</span>
            {p.id === 'COMMAND' && alerts > 0 && <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-nx-red" />}
          </button>
        )
      })}
      <div className="mt-auto flex flex-col items-center gap-1 pb-1">
        <div className="text-center font-mono text-[8px] leading-tight text-nx-faint">
          <div>v1.0</div>
        </div>
      </div>
    </nav>
  )
}

export function NexusMark({ size = 18, color = '#39c9e6' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="2.1" fill={color} />
      <circle cx="4.5" cy="6" r="1.5" fill={color} opacity="0.85" />
      <circle cx="19.5" cy="6" r="1.5" fill={color} opacity="0.85" />
      <circle cx="4.5" cy="18" r="1.5" fill={color} opacity="0.85" />
      <circle cx="19.5" cy="18" r="1.5" fill={color} opacity="0.85" />
      <path d="M4.5 6 L12 12 L19.5 6 M4.5 18 L12 12 L19.5 18" stroke={color} strokeWidth="1.1" opacity="0.5" />
      <path d="M4.5 6 L4.5 18 M19.5 6 L19.5 18" stroke={color} strokeWidth="0.9" opacity="0.28" />
    </svg>
  )
}

function timecode(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function TopBar() {
  const snap = useNexus((s) => s.snapshot)
  const setRunning = useNexus((s) => s.setRunning)
  const setSpeed = useNexus((s) => s.setSpeed)
  const reset = useNexus((s) => s.reset)
  const page = useNexus((s) => s.page)
  const bridge = snap.bridge
  const physBound = snap.bindings.length
  const degraded = snap.twins.filter((t) => t.syncState !== 'SYNCED').length

  return (
    <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-nx-line bg-nx-base px-3">
      <div className="flex items-center gap-2">
        <NexusMark size={20} />
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-[0.14em] text-nx-text">KUBERA</div>
          <div className="mt-[3px] text-[9px] uppercase tracking-[0.1em] text-nx-faint">Decentralised autonomous warehouse coordination</div>
        </div>
      </div>

      <div className="mx-1 h-6 w-px bg-nx-line" />
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-nx-dim">{page}</div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden items-center gap-3 lg:flex">
          <div className="text-right">
            <div className="nx-h">Sim clock</div>
            <div className="font-mono text-[12px] tabular-nums text-nx-text">T+{timecode(snap.simTimeS)}</div>
          </div>
          <div className="text-right">
            <div className="nx-h">Agents</div>
            <div className="font-mono text-[12px] tabular-nums text-nx-text">
              {snap.agents.length}
              <span className="text-nx-faint"> / {physBound} phys</span>
            </div>
          </div>
          <div className="text-right">
            <div className="nx-h">Throughput</div>
            <div className="font-mono text-[12px] tabular-nums text-nx-text">{snap.metrics.throughputPerHour.toFixed(0)}<span className="text-nx-faint">/h</span></div>
          </div>
        </div>

        <div className="h-6 w-px bg-nx-line" />

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setRunning(!snap.running)}
            className={`nx-btn ${snap.running ? '' : 'nx-btn-primary'}`}
            title={snap.running ? 'Pause simulation' : 'Resume simulation'}
          >
            {snap.running ? <Pause size={12} /> : <Play size={12} />}
            {snap.running ? 'PAUSE' : 'RUN'}
          </button>
          <SegmentedControl
            value={snap.speed}
            onChange={(v) => setSpeed(v as number)}
            options={[
              { value: 1, label: '1×' },
              { value: 2, label: '2×' },
              { value: 5, label: '5×' },
            ]}
          />
          <button className="nx-btn" onClick={reset} title="Reset to deterministic seed">
            <RotateCcw size={12} />
          </button>
        </div>

        <div className="h-6 w-px bg-nx-line" />

        <div className="flex items-center gap-1.5">
          <Chip tone={bridge.connected ? 'green' : 'amber'} dot title={bridge.detail}>
            {bridge.connected ? 'BRIDGE ONLINE' : 'BRIDGE LOCAL'}
          </Chip>
          {degraded > 0 && (
            <Chip tone="red" dot title={`${degraded} digital twin(s) not synced`}>
              {degraded} TWIN DEGRADED
            </Chip>
          )}
          <Chip tone={snap.metrics.activeConflicts > 0 ? 'amber' : 'neutral'} title="Active traffic conflicts">
            <GitBranch size={10} /> {snap.metrics.activeConflicts}
          </Chip>
          <Chip tone={snap.metrics.collisionCount > 0 ? 'red' : 'green'} title="Body separations required">
            <ShieldCheck size={10} /> {snap.metrics.collisionCount}
          </Chip>
        </div>
      </div>
    </header>
  )
}

export function useKeyboardShortcuts() {
  const setRunning = useNexus((s) => s.setRunning)
  const snap = useNexus((s) => s.snapshot)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        setRunning(!useNexus.getState().snapshot.running)
      }
      if (e.key === '1') useNexus.getState().setSpeed(1)
      if (e.key === '2') useNexus.getState().setSpeed(2)
      if (e.key === '5') useNexus.getState().setSpeed(5)
      const pages: Page[] = ['COMMAND', 'FLEET', 'TASKS', 'TRAFFIC', 'TWIN', 'EXPERIMENTS', 'SYSTEM']
      const idx = Number(e.key)
      if (idx >= 1 && idx <= 7 && e.altKey) useNexus.getState().setPage(pages[idx - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setRunning, snap.running])
}

export function StatusStrip() {
  const snap = useNexus((s) => s.snapshot)
  const m = snap.metrics
  const items = [
    { label: 'Tasks done', value: `${m.tasksCompleted}` },
    { label: 'Active', value: `${m.tasksActive}`, tone: m.tasksActive ? 'cyan' : undefined },
    { label: 'Queued', value: `${m.tasksQueued}`, tone: m.tasksQueued > 2 ? 'amber' : undefined },
    { label: 'Utilisation', value: `${(m.fleetUtilization * 100).toFixed(0)}%` },
    { label: 'Replans', value: `${m.replanCount}` },
    { label: 'Yields', value: `${m.yieldCount}` },
    { label: 'Reassign', value: `${m.reassignmentCount}`, tone: m.reassignmentCount ? 'amber' : undefined },
    { label: 'Near miss', value: `${m.nearMissCount}` },
    { label: 'Distance', value: `${m.distanceTravelledM.toFixed(0)} m` },
    { label: 'Sim rate', value: `${snap.fps} fps` },
  ]
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 flex items-center gap-4 border-t border-nx-line/80 bg-nx-base/85 px-3 py-1.5 backdrop-blur">
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-nx-faint">{i.label}</span>
          <span
            className={`font-mono text-[11px] tabular-nums ${
              i.tone === 'cyan' ? 'text-nx-cyan' : i.tone === 'amber' ? 'text-nx-amber' : 'text-nx-text'
            }`}
          >
            {i.value}
          </span>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-nx-faint">
        <Radio size={10} className="text-nx-green" />
        mesh {snap.meshTraffic.sent} sent · {snap.meshTraffic.delivered} delivered
        <Activity size={10} />
        {snap.metrics.linkLatencyMs.toFixed(0)} ms
      </div>
    </div>
  )
}
