import { ArrowRight, Package, X } from 'lucide-react'
import { Bar, Chip, Divider, Dot, Panel } from '../../components/ui'
import { useNexus } from '../../store/useNexus'
import type { Task } from '../../types'

export const taskStatusTone = (s: Task['status']) =>
  s === 'COMPLETED' ? 'green' : s === 'FAILED' ? 'red' : s === 'REASSIGNING' ? 'amber' : s === 'IN_PROGRESS' ? 'cyan' : s === 'ASSIGNED' ? 'blue' : 'neutral'

export const priorityTone = (p: Task['priority']) =>
  p === 'CRITICAL' ? 'red' : p === 'HIGH' ? 'amber' : p === 'NORMAL' ? 'cyan' : 'neutral'

function elapsed(task: Task, now: number) {
  const end = task.completedAt ?? now
  return `${(end - task.createdAt).toFixed(1)} s`
}

/** full allocation reasoning for one task — why this robot, not another */
export function TaskPanel({ task }: { task: Task }) {
  const selectTask = useNexus((s) => s.selectTask)
  const selectAgent = useNexus((s) => s.selectAgent)
  const now = useNexus((s) => s.snapshot.simTimeS)
  const agents = useNexus((s) => s.snapshot.agents)
  const bids = [...task.evaluation].sort((a, b) => (a.cost === b.cost ? 0 : a.cost - b.cost))
  const capable = bids.filter((b) => b.capable)

  return (
    <Panel
      className="nx-slide-in pointer-events-auto flex max-h-[calc(100vh-118px)] w-[380px] flex-col overflow-hidden"
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-nx-text">{task.id}</span>
          <Chip tone={taskStatusTone(task.status) as never} dot>
            {task.status}
          </Chip>
          <Chip tone={priorityTone(task.priority) as never}>{task.priority}</Chip>
        </span>
      }
      right={
        <button className="text-nx-faint hover:text-nx-text" onClick={() => selectTask(null)}>
          <X size={13} />
        </button>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <div className="rounded border border-nx-line/80 bg-nx-panel2/50 p-2.5">
          <div className="nx-h">Route</div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-nx-text">
            {task.steps.map((s, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <ArrowRight size={10} className="text-nx-faint" />}
                <span className={s.status === 'DONE' ? 'text-nx-green' : s.status === 'ACTIVE' ? 'text-nx-cyan' : 'text-nx-dim'}>{s.targetId}</span>
              </span>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div>
              <div className="nx-h">Assigned</div>
              <button
                className="font-mono text-[12px] text-nx-cyan hover:underline"
                onClick={() => task.assignedTo && selectAgent(task.assignedTo)}
              >
                {task.assignedTo ?? '—'}
              </button>
            </div>
            <div>
              <div className="nx-h">Elapsed</div>
              <div className="font-mono text-[12px] text-nx-text">{elapsed(task, now)}</div>
            </div>
            <div>
              <div className="nx-h">Reassignments</div>
              <div className={`font-mono text-[12px] ${task.reassignmentCount ? 'text-nx-amber' : 'text-nx-text'}`}>{task.reassignmentCount}</div>
            </div>
          </div>
          {task.packageId && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-nx-dim">
              <Package size={11} /> {task.packageId} · {task.requestedBy}
            </div>
          )}
        </div>

        <Divider label="Allocation — sealed-bid auction" />
        <div className="space-y-1">
          {bids.length === 0 && <div className="text-[11px] text-nx-faint">No bids recorded yet</div>}
          {bids.map((b) => {
            const agent = agents.find((a) => a.id === b.agentId)
            const won = task.assignedTo === b.agentId
            const best = capable.length > 0 && capable[0].agentId === b.agentId
            return (
              <div
                key={b.agentId}
                className={`rounded border px-2 py-1.5 ${
                  won ? 'border-nx-green/40 bg-nx-green/[0.07]' : !b.capable ? 'border-nx-line/60 opacity-70' : 'border-nx-line/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Dot tone={won ? 'green' : b.capable ? 'cyan' : 'dim'} />
                  <button className="font-mono text-[11px] text-nx-text hover:underline" onClick={() => selectAgent(b.agentId)}>
                    {b.agentId}
                  </button>
                  <Chip tone={agent?.executionMode === 'PHYSICAL' ? 'orange' : 'neutral'} className="!px-1 !py-0">
                    {agent?.executionMode === 'PHYSICAL' ? 'REAL' : 'SIM'}
                  </Chip>
                  {won && <Chip tone="green">AWARDED</Chip>}
                  {!won && best && <Chip tone="cyan">LOWEST COST</Chip>}
                  <span className="ml-auto font-mono text-[10px] text-nx-dim">
                    {b.capable ? `cost ${b.cost.toFixed(2)}` : 'not capable'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 font-mono text-[9.5px] text-nx-faint">
                  <span>{b.distanceM.toFixed(1)} m</span>
                  <span>{(b.battery * 100) | 0}%</span>
                  <span>eta {b.etaS.toFixed(0)}s</span>
                  <span>congestion −{b.congestionPenalty.toFixed(1)}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-nx-dim">{b.note}</div>
              </div>
            )
          })}
        </div>

        <Divider label="Lifecycle" />
        <ol className="space-y-1">
          {task.history.slice(-10).map((h, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-[3px] font-mono text-[9.5px] text-nx-faint">{h.at.toFixed(1)}s</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-nx-dim">{h.event}</span>
              <span className="ml-auto max-w-[190px] text-right text-[10px] text-nx-faint">{h.detail}</span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  )
}

export function TaskListPanel({ onClose }: { onClose: () => void }) {
  const tasks = useNexus((s) => s.snapshot.tasks)
  const now = useNexus((s) => s.snapshot.simTimeS)
  const selectedTaskId = useNexus((s) => s.selectedTaskId)
  const selectTask = useNexus((s) => s.selectTask)

  return (
    <Panel
      className="nx-slide-in pointer-events-auto flex max-h-[calc(100vh-118px)] w-[420px] flex-col overflow-hidden"
      title={<span>TASK MARKET · lifecycle</span>}
      right={
        <button className="text-nx-faint hover:text-nx-text" onClick={onClose}>
          <X size={13} />
        </button>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.length === 0 && <div className="px-3 py-6 text-center text-[11px] text-nx-faint">No tasks yet</div>}
        {tasks.map((t) => {
          const active = selectedTaskId === t.id
          return (
            <button
              key={t.id}
              onClick={() => selectTask(t.id)}
              className={`block w-full border-b border-nx-line/60 px-3 py-2 text-left transition-colors ${
                active ? 'bg-nx-cyan/[0.07]' : 'hover:bg-nx-line/25'
              }`}
            >
              <div className="flex items-center gap-2">
                <Dot tone={taskStatusTone(t.status) as never} pulse={t.status === 'IN_PROGRESS'} />
                <span className="font-mono text-[11px] text-nx-text">{t.id}</span>
                <Chip tone={priorityTone(t.priority) as never} className="!px-1 !py-0">
                  {t.priority}
                </Chip>
                <span className="ml-auto font-mono text-[10px] text-nx-dim">{t.assignedTo ?? 'unassigned'}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10.5px] text-nx-dim">
                <span className="font-mono">{t.steps.map((s) => s.targetId).join(' → ')}</span>
                <span className="ml-auto font-mono text-nx-faint">{elapsed(t, now)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Chip tone={taskStatusTone(t.status) as never}>{t.status}</Chip>
                {t.reassignmentCount > 0 && <Chip tone="amber">REASSIGNED ×{t.reassignmentCount}</Chip>}
                <div className="ml-auto flex items-center gap-[3px]">
                  {t.steps.map((s, i) => (
                    <span
                      key={i}
                      className={`h-[3px] w-6 rounded-sm ${
                        s.status === 'DONE' ? 'bg-nx-green' : s.status === 'ACTIVE' ? 'bg-nx-cyan' : 'bg-nx-line2'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

/** compact list used on the command centre */
export function TaskTicker() {
  const tasks = useNexus((s) => s.snapshot.tasks.slice(0, 6))
  const selectTask = useNexus((s) => s.selectTask)
  const open = useNexus((s) => s.snapshot.openTasks.length)
  return (
    <Panel
      className="pointer-events-auto w-[330px]"
      dense
      title={<span>TASK MARKET</span>}
      right={<Chip tone={open ? 'cyan' : 'neutral'}>{open} OPEN</Chip>}
    >
      <div className="max-h-[190px] overflow-y-auto">
        {tasks.map((t) => (
          <button key={t.id} onClick={() => selectTask(t.id)} className="block w-full px-2.5 py-[7px] text-left hover:bg-nx-line/25">
            <div className="flex items-center gap-1.5">
              <Dot tone={taskStatusTone(t.status) as never} pulse={t.status === 'IN_PROGRESS'} />
              <span className="font-mono text-[10.5px] text-nx-text">{t.id}</span>
              <span className="ml-auto font-mono text-[9.5px] text-nx-faint">{t.assignedTo ?? '—'}</span>
            </div>
            <div className="mt-[3px] flex items-center gap-1.5">
              <span className="truncate font-mono text-[9.5px] text-nx-dim">{t.steps.map((s) => s.targetId).join(' → ')}</span>
              <Bar value={t.currentStep / t.steps.length} tone={taskStatusTone(t.status) === 'green' ? 'green' : 'cyan'} height={2} className="ml-auto w-10" />
            </div>
          </button>
        ))}
        {tasks.length === 0 && <div className="px-3 py-4 text-center text-[10.5px] text-nx-faint">market idle</div>}
      </div>
    </Panel>
  )
}
