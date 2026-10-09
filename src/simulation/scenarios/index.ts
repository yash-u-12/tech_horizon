import type { NexusEngine } from '../engine'

/**
 * EXPERIMENTS / SCENARIOS (Phase 12)
 *
 * Every scenario mutates real simulation state. None of them are animations:
 * they inject faults, obstacles, link loss or placements, and then the ordinary
 * agent loop has to cope. `setup` books a baseline window first so experiments
 * always have a comparison period.
 */
export interface ScenarioDef {
  id: string
  label: string
  category: 'OPERATION' | 'FAILURE' | 'TRAFFIC' | 'PHYSICAL' | 'DEPLOYMENT'
  description: string
  /** sim seconds to run after apply() */
  durationS: number
  /** what the presenter should watch for */
  observe: string
  apply: (engine: NexusEngine) => string
}

function busiestIdleAgent(engine: NexusEngine, exclude: string[] = []): string | null {
  const candidates = [...engine.agents.values()].filter((a) => !exclude.includes(a.id) && !a.fault && !a.hardwareId)
  if (!candidates.length) return null
  candidates.sort((a, b) => b.memory.distanceTravelledM - a.memory.distanceTravelledM)
  return candidates[0].id
}

function agentWithTask(engine: NexusEngine): string | null {
  const a = [...engine.agents.values()].find((x) => x.task && !x.fault)
  return a?.id ?? null
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'normal',
    label: 'A · Normal decentralised operation',
    category: 'OPERATION',
    description: 'No injection. The fleet keeps bidding, planning and executing on its own.',
    durationS: 120,
    observe: 'Independent routes, auctions every 0.75 s, tasks completing without operator input.',
    apply: () => 'baseline operation — nothing injected',
  },
  {
    id: 'robot_failure',
    label: 'B · Robot failure',
    category: 'FAILURE',
    description: 'Injects a drive-controller fault into a loaded agent; it stops mid-route.',
    durationS: 60,
    observe: 'Agent goes FAILED, body stops, its task is released to the market and re-awarded.',
    apply: (engine) => {
      const id = agentWithTask(engine) ?? busiestIdleAgent(engine)
      if (!id) return 'no agent available'
      engine.injectFault(id, 'DRIVE_CONTROLLER_FAULT')
      return `${id} — drive controller fault injected`
    },
  },
  {
    id: 'blocked_aisle',
    label: 'C · Blocked aisle',
    category: 'OPERATION',
    description: 'Drops a pallet across the busiest aisle for 90 s.',
    durationS: 90,
    observe: 'Perception sees the obstruction, routes are invalidated and replanned around it.',
    apply: (engine) => {
      const a = [...engine.agents.values()].find((x) => x.path && x.task)
      const pt = a?.path?.points[Math.min(a.path.points.length - 1, a.pathIndex + 16)] ?? { x: 1, z: 7.5 }
      const obs = engine.spawnTemporaryObstacle({ x: pt.x, z: pt.z, w: 2.2, d: 2.2 }, 'PALLET DOWN', 90)
      return `obstruction ${obs.id} blocking (${pt.x.toFixed(1)}, ${pt.z.toFixed(1)}) for 90 s`
    },
  },
  {
    id: 'traffic_conflict',
    label: 'D · Traffic conflict / aisle crossing',
    category: 'TRAFFIC',
    description: 'Two idle agents are placed at opposite ends of the same aisle and told to swap sides.',
    durationS: 90,
    observe: 'TTC is computed locally, one agent yields (or detours), the other proceeds. No coordinator involved.',
    apply: (engine) => {
      const ids = [...engine.agents.values()].filter((a) => a.backendKind === 'SIMULATION' && !a.fault).map((a) => a.id)
      if (ids.length < 2) return 'not enough agents'
      const [a, b] = ids
      engine.placeAgent(a, 1, 7.5, -Math.PI / 2)
      engine.placeAgent(b, 1, -7.5, Math.PI / 2)
      engine.setStandbyGoal(a, { x: 1, z: -7.5 })
      engine.setStandbyGoal(b, { x: 1, z: 7.5 })
      return `${a} and ${b} routed head-on through the same aisle`
    },
  },
  {
    id: 'task_surge',
    label: 'E · Task surge',
    category: 'OPERATION',
    description: 'Pushes five high-priority transport tasks into the market at once.',
    durationS: 120,
    observe: 'Sealed-bid auctions resolve contention; agents with spare capacity take the work.',
    apply: (engine) => {
      const stored = [...engine.packages.values()].filter((p) => p.state === 'STORED')
      const drops = ['OUTBOUND-S1', 'PACKING-S1', 'SORTING-S1', 'OUTBOUND-S2', 'PACKING-S2']
      let n = 0
      for (let i = 0; i < Math.min(5, stored.length); i++) {
        const t = engine.createTransportTask(stored[i].id, drops[i % drops.length], 'HIGH', `SURGE ${stored[i].label} → ${drops[i % drops.length]}`, 'OPERATOR')
        if (t) n++
      }
      return `${n} HIGH priority tasks injected`
    },
  },
  {
    id: 'comms_degradation',
    label: 'F · Communication degradation',
    category: 'FAILURE',
    description: 'Raises mesh latency to 400 ms with 25% loss for 30 s.',
    durationS: 60,
    observe: 'Intent exchange degrades; agents still act on local perception — behaviour gets more conservative.',
    apply: (engine) => {
      engine.injectLinkDegradation(400, 0.25, 30)
      return 'mesh latency 400 ms · loss 25% for 30 s'
    },
  },
  {
    id: 'low_battery',
    label: 'G · Low battery',
    category: 'FAILURE',
    description: 'Drains a loaded agent to 9% and lets its own policy decide.',
    durationS: 90,
    observe: 'The agent releases its task and routes to a charging bay by itself.',
    apply: (engine) => {
      const id = agentWithTask(engine) ?? busiestIdleAgent(engine)
      if (!id) return 'no agent available'
      const a = engine.agents.get(id)!
      a.setBattery(0.09)
      return `${id} battery forced to 9%`
    },
  },
  {
    id: 'physical_disconnect',
    label: 'H · Physical robot disconnect',
    category: 'PHYSICAL',
    description: 'Cuts telemetry from the hardware unit for 25 s.',
    durationS: 60,
    observe: 'Twin degrades to DEGRADED then LOST, physical link is reported OFFLINE, commands are blocked by the safety layer.',
    apply: (engine) => {
      const bound = engine.binding.hardwareList().find((h) => h.boundAgentId)
      const hw = bound ?? engine.binding.hardware.get('P01')
      if (!hw) return 'no hardware'
      engine.physicalDropout(hw.id, 25)
      return `${hw.id} telemetry lost for 25 s${bound ? ` (hosting ${bound.boundAgentId})` : ''}`
    },
  },
  {
    id: 'physical_reconnect',
    label: 'I · Physical robot reconnect',
    category: 'PHYSICAL',
    description: 'Ends any active dropout immediately and lets telemetry resume.',
    durationS: 45,
    observe: 'Twin returns to SYNCED, position error re-converges, commands flow again.',
    apply: (engine) => {
      for (const hw of engine.binding.hardwareList()) engine.resumeHardware(hw.id)
      return 'hardware links restored'
    },
  },
  {
    id: 'agent_deployment',
    label: 'J · Agent deployment',
    category: 'DEPLOYMENT',
    description: 'Runs the full deployment sequence for a simulated agent onto P01.',
    durationS: 60,
    observe: 'Compatibility → safety → stop → queue clear → sync → control enabled. Identity never changes.',
    apply: (engine) => {
      const a = [...engine.agents.values()].find((x) => !x.hardwareId && !x.fault)
      if (!a) return 'no free agent'
      const proc = engine.requestDeploy(a.id, 'P01')
      return proc ? `${a.id} → P01 deployment started` : `deployment refused for ${a.id}`
    },
  },
  {
    id: 'agent_rebinding',
    label: 'K · Agent rebinding',
    category: 'DEPLOYMENT',
    description: 'Safely unbinds the current agent, then binds a different agent to the same hardware.',
    durationS: 90,
    observe: 'Stop → safe state → detach → validate → sync → enable. The second agent keeps its own task and context.',
    apply: (engine) => {
      const bound = engine.binding.hardwareList().find((h) => h.boundAgentId)
      if (!bound?.boundAgentId) {
        const a = [...engine.agents.values()].find((x) => !x.fault)
        if (!a) return 'no agent'
        engine.requestDeploy(a.id, 'P01')
        return `no active binding — deploying ${a.id} to P01 first`
      }
      const current = bound.boundAgentId
      engine.requestUnbind(current)
      const other = [...engine.agents.values()].find((x) => x.id !== current && !x.fault)
      if (other) engine.queueDeploy(other.id, bound.id)
      return `unbinding ${current} → ${other?.id} will take ${bound.id}`
    },
  },
]

export function scenarioById(id: string) {
  return SCENARIOS.find((s) => s.id === id) ?? null
}

/** scenario appliers are pushed into the engine so it needs no import back into here */
export function registerScenarios(engine: NexusEngine) {
  for (const s of SCENARIOS) engine.scenarioAppliers.set(s.id, () => s.apply(engine))
}

export function runScenarioById(engine: NexusEngine, id: string) {
  const def = scenarioById(id)
  if (!def) return { ok: false, detail: `unknown scenario ${id}` }
  registerScenarios(engine)
  return engine.runScenario(def.id, def.label, def.durationS)
}
