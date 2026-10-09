import { useState } from 'react'
import { Activity, Boxes, Cpu, FlaskConical, GitBranch, ListChecks, Radio } from 'lucide-react'
import { useNexus } from '../../store/useNexus'
import { RobotPanel } from '../panels/RobotPanel'
import { TaskPanel, TaskListPanel, TaskTicker } from '../panels/TaskPanels'
import { FleetPanel, FleetStrip } from '../panels/FleetPanel'
import { EventStream, MeshFeed } from '../panels/EventStream'
import { TrafficPanel, TrafficStrip } from '../panels/TrafficPanel'
import { TwinPanel } from '../panels/TwinPanel'
import { ExperimentsPanel } from '../panels/ExperimentsPanel'
import { SystemPanel } from '../panels/SystemPanel'
import { CommandBar } from '../panels/CommandBar'
import { Chip, Dot, Panel, ToggleChip } from '../../components/ui'

/* ------------------------------------------------------------------ command */

export function CommandPage() {
  const selectedAgentId = useNexus((s) => s.selectedAgentId)
  const selectedTaskId = useNexus((s) => s.selectedTaskId)
  const agents = useNexus((s) => s.snapshot.agents)
  const tasks = useNexus((s) => s.snapshot.tasks)
  const selectAgent = useNexus((s) => s.selectAgent)
  const twins = useNexus((s) => s.snapshot.twins)
  const bindings = useNexus((s) => s.snapshot.bindings)
  const agent = agents.find((a) => a.id === selectedAgentId)
  const task = tasks.find((t) => t.id === selectedTaskId)
  const degraded = twins.filter((t) => t.syncState !== 'SYNCED')

  return (
    <>
      {/* top-left: control surface */}
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <CommandBar />
      </div>

      {/* left column: situational awareness */}
      <div className="pointer-events-none absolute left-3 top-[62px] z-20 flex flex-col gap-2">
        {degraded.length > 0 && (
          <Panel className="pointer-events-auto w-[330px] border-nx-red/40" dense title={<span className="text-nx-red">PHYSICAL LINK DEGRADED</span>}>
            <div className="px-2.5 py-1.5">
              {degraded.map((t) => (
                <div key={t.agentId} className="flex items-center gap-2 py-0.5">
                  <Dot tone={t.syncState === 'LOST' ? 'red' : 'amber'} pulse />
                  <span className="font-mono text-[10.5px] text-nx-text">
                    {t.agentId} ↔ {t.hardwareId}
                  </span>
                  <Chip tone={t.syncState === 'LOST' ? 'red' : 'amber'} className="ml-auto !px-1 !py-0">
                    {t.syncState}
                  </Chip>
                  <span className="font-mono text-[9.5px] text-nx-faint">{(t.telemetryAgeMs / 1000).toFixed(1)}s</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
        <MeshFeed />
      </div>

      {/* bottom-left: event stream */}
      <div className="pointer-events-none absolute bottom-[54px] left-3 z-20">
        <EventStream />
      </div>

      {/* bottom-centre: fleet strip */}
      <div className="pointer-events-none absolute bottom-[46px] left-1/2 z-20 -translate-x-1/2">
        <FleetStrip />
      </div>

      {/* bottom-right: task market */}
      <div className="pointer-events-none absolute bottom-[54px] right-3 z-20">
        <TaskTicker />
      </div>

      {/* right: contextual detail */}
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
        {agent && <RobotPanel agent={agent} />}
        {!agent && task && <TaskPanel task={task} />}
        {!agent && !task && (
          <Panel className="pointer-events-auto w-[248px]" dense title="SELECT AN ENTITY">
            <div className="space-y-1 px-2.5 py-2 text-[10.5px] leading-relaxed text-nx-dim">
              <div className="flex items-center gap-1.5">
                <Boxes size={11} className="text-nx-cyan" /> click an AMR for its individual context
              </div>
              <div className="flex items-center gap-1.5">
                <ListChecks size={11} className="text-nx-amber" /> click a task for its allocation reasoning
              </div>
              <div className="flex items-center gap-1.5">
                <Activity size={11} className="text-nx-orange" /> click a hardware unit for its twin
              </div>
              <div className="mt-1.5 border-t border-nx-line/70 pt-1.5 text-nx-faint">
                {agents.length} agents · {bindings.length} on physical hardware
              </div>
            </div>
          </Panel>
        )}
      </div>
    </>
  )
}

/* -------------------------------------------------------------------- fleet */

export function FleetPage() {
  const selectedAgentId = useNexus((s) => s.selectedAgentId)
  const agents = useNexus((s) => s.snapshot.agents)
  const [showPanel, setShowPanel] = useState(true)
  const agent = agents.find((a) => a.id === selectedAgentId)
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <CommandBar />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-start gap-2">
        {agent && <RobotPanel agent={agent} />}
        {showPanel && <FleetPanel onClose={() => setShowPanel(false)} />}
      </div>
      <div className="pointer-events-none absolute bottom-[46px] left-1/2 z-20 -translate-x-1/2">
        <FleetStrip />
      </div>
      <PageHint icon={<Boxes size={11} />} text="Selecting a row focuses that agent in the warehouse. Deploy hands a simulated agent a physical body." />
    </>
  )
}

/* -------------------------------------------------------------------- tasks */

export function TasksPage() {
  const selectedTaskId = useNexus((s) => s.selectedTaskId)
  const tasks = useNexus((s) => s.snapshot.tasks)
  const [showList, setShowList] = useState(true)
  const task = tasks.find((t) => t.id === selectedTaskId)
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <CommandBar />
      </div>
      <div className="pointer-events-none absolute left-3 top-[62px] z-20">{showList && <TaskListPanel onClose={() => setShowList(false)} />}</div>
      {task && (
        <div className="pointer-events-none absolute right-3 top-3 z-20">
          <TaskPanel task={task} />
        </div>
      )}
      <PageHint icon={<ListChecks size={11} />} text="Every task shows the sealed-bid auction that allocated it — who bid, what they cost, and why the winner won." />
    </>
  )
}

/* ------------------------------------------------------------------ traffic */

export function TrafficPage() {
  const [showPanel, setShowPanel] = useState(true)
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <CommandBar />
      </div>
      <div className="pointer-events-none absolute left-3 top-[62px] z-20">
        <TrafficStrip />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-20">{showPanel && <TrafficPanel onClose={() => setShowPanel(false)} />}</div>
      <PageHint icon={<GitBranch size={11} />} text="Conflicts are resolved locally by each agent using its own perception plus deterministic right-of-way rules." />
    </>
  )
}

/* --------------------------------------------------------------------- twin */

export function TwinPage() {
  const [showPanel, setShowPanel] = useState(true)
  const twins = useNexus((s) => s.snapshot.twins)
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <CommandBar />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-20">{showPanel && <TwinPanel onClose={() => setShowPanel(false)} />}</div>
      <div className="pointer-events-none absolute left-3 top-[62px] z-20 w-[286px]">
        <Panel dense title="PHYSICAL WORLD → DIGITAL TWIN">
          <div className="space-y-1 px-2.5 py-2 font-mono text-[9.5px] leading-relaxed text-nx-faint">
            <div>sensors / odometry</div>
            <div className="pl-2 text-nx-dim">↓ robot gateway</div>
            <div>telemetry normalisation</div>
            <div className="pl-2 text-nx-dim">↓ websocket</div>
            <div className="text-nx-orange">digital twin</div>
            <div className="pl-2 text-nx-dim">↓ shared environment</div>
            <div>virtual agents perceive it</div>
            <div className="pl-2 text-nx-dim">↓ validated commands</div>
            <div>physical motion</div>
          </div>
        </Panel>
        <div className="mt-2">
          <Panel dense title={<span>TWIN STATE</span>} right={<Chip tone={twins.length ? 'orange' : 'neutral'}>{twins.length} LIVE</Chip>}>
            <div className="px-2.5 py-2 text-[10.5px] text-nx-dim">
              {twins.length === 0
                ? 'No agents are currently deployed. Deploy a simulated agent from the fleet page or the deployment demo.'
                : twins.map((t) => (
                    <div key={t.agentId} className="flex items-center gap-2 py-0.5 font-mono text-[10px]">
                      <Dot tone={t.syncState === 'SYNCED' ? 'green' : 'amber'} pulse />
                      <span className="text-nx-text">{t.agentId}</span>
                      <span className="text-nx-faint">↔ {t.hardwareId}</span>
                      <span className="ml-auto text-nx-dim">{t.positionErrorM.toFixed(3)} m</span>
                    </div>
                  ))}
            </div>
          </Panel>
        </div>
      </div>
      <PageHint icon={<Radio size={11} />} text="Planned pose comes from the agent's planner; actual pose comes from telemetry. They are never conflated." />
    </>
  )
}

/* -------------------------------------------------------------- experiments */

export function ExperimentsPage() {
  const [showPanel, setShowPanel] = useState(true)
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <CommandBar />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-20">{showPanel && <ExperimentsPanel onClose={() => setShowPanel(false)} />}</div>
      <PageHint icon={<FlaskConical size={11} />} text="Scenarios mutate real state — faults, obstacles, link loss, placements, deployments — then the normal agent loop must cope." />
    </>
  )
}

/* ------------------------------------------------------------------- system */

export function SystemPage() {
  const [showPanel, setShowPanel] = useState(true)
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20">
        <CommandBar />
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-20">{showPanel && <SystemPanel onClose={() => setShowPanel(false)} />}</div>
      <PageHint icon={<Cpu size={11} />} text="If the ROS 2 / hardware bridge is not connected, KUBERA says so instead of pretending the physical robot is online." />
    </>
  )
}

function PageHint({ icon, text }: { icon: React.ReactNode; text: string }) {
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <div className="pointer-events-auto absolute bottom-[46px] left-3 z-20 max-w-[520px]" onClick={() => setOpen(false)}>
      <div className="flex items-center gap-2 rounded border border-nx-line/70 bg-nx-base/85 px-2.5 py-1.5 text-[10.5px] text-nx-dim backdrop-blur">
        <span className="text-nx-cyan">{icon}</span>
        {text}
      </div>
    </div>
  )
}

export { ToggleChip }
