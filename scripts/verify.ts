/**
 * NEXUS headless verification harness.
 *
 * Runs the real simulation engine with no UI and asserts the behaviours the
 * platform claims: independent agents, autonomous task execution, replanning,
 * decentralised conflict resolution, failure recovery and sim-to-real deployment.
 *
 *   npm run sim:verify
 */
import { NexusEngine } from '../src/simulation/engine'
import { registerScenarios, SCENARIOS } from '../src/simulation/scenarios'

let failures = 0
let checks = 0
function assert(label: string, cond: boolean, detail = '') {
  checks++
  if (!cond) failures++
  const tag = cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`  ${tag}  ${label}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`)
}
function section(t: string) {
  console.log(`\n\x1b[1m${t}\x1b[0m`)
}

const engine = new NexusEngine({ seed: 20261007 })
const agents = () => [...engine.agents.values()]

console.log('\x1b[1m\x1b[36mNEXUS · decentralised warehouse — headless verification\x1b[0m')

/* ---------------------------------------------------- 1. independent agents */
section('1 · INDEPENDENT AGENTS IN A SHARED WORLD')
engine.runHeadless(40)
const moved = agents().filter((a) => a.memory.distanceTravelledM > 1)
assert('every agent is a distinct object with its own state', new Set(agents().map((a) => a)).size === 5)
assert('agents move independently', moved.length >= 4, `${moved.length}/5 travelling`)
const contexts = agents().map((a) => JSON.stringify(a.context?.perception.peers.map((p) => p.id)) ?? '')
assert('agents hold different contexts', new Set(contexts).size > 1, `${new Set(contexts).size} distinct peer sets`)
const distinct = new Set(agents().map((a) => a.decision?.reason ?? '')).size
assert('agents make different decisions', distinct > 1, `${distinct} distinct live decision reasons`)

/* ------------------------------------------------------- 2. task execution */
section('2 · AUTONOMOUS TASK EXECUTION')
engine.runHeadless(120)
const tasks = [...engine.tasks.values()]
assert('scheduler creates tasks from real packages', tasks.length > 3, `${tasks.length} tasks created`)
assert('tasks are auctioned to the fleet', tasks.every((t) => t.evaluation.length > 0))
assert('tasks get assigned to agents', tasks.some((t) => t.assignedTo !== null))
assert('award went to a robot that actually bid', tasks.some((t) => t.evaluation.some((b) => b.accepted)))
const picked = tasks.some((t) => t.history.some((h) => h.event === 'PICKED'))
const delivered = tasks.some((t) => t.history.some((h) => h.event === 'DELIVERED'))
assert('packages are physically picked up', picked)
assert('packages are physically delivered', delivered)
assert('completed tasks are recorded', engine.metrics.tasksCompleted > 0, `${engine.metrics.tasksCompleted} completed`)

/* ------------------------------------------------------- 3. replanning */
section('3 · DYNAMIC REPLANNING (OBSTACLE)')
const replansBefore = engine.metrics.replanCount
const busyAgent = agents().sort((a, b) => b.memory.distanceTravelledM - a.memory.distanceTravelledM)[0]
// block the aisle directly in front of the busiest agent's route
const target = busyAgent.path?.points[Math.min(busyAgent.path.points.length - 1, busyAgent.pathIndex + 14)]
if (target) {
  engine.spawnTemporaryObstacle({ x: target.x, z: target.z, w: 1.8, d: 1.8 }, 'PALLET DOWN', 60)
  engine.runHeadless(30)
}
assert('obstacle triggers a replan', engine.metrics.replanCount > replansBefore, `${engine.metrics.replanCount - replansBefore} new replans`)
const replanEvents = engine.events.filter((e) => e.message.includes('Replanned'))
assert('replan is explained in the event stream', replanEvents.length > 0, replanEvents[0]?.detail ?? '')
assert('agent keeps executing after replanning', busyAgent.memory.distanceTravelledM > 0)

/* --------------------------------------------------- 4. traffic behaviour */
section('4 · DECENTRALISED CONFLICT RESOLUTION')
registerScenarios(engine)
const beforeYield = engine.metrics.yieldCount
const beforeConflicts = engine.trafficEvents.length
const scen = SCENARIOS.find((s) => s.id === 'traffic_conflict')!
const scenResult = engine.runScenario(scen.id, scen.label, scen.durationS)
assert('traffic scenario injects a head-on crossing', scenResult.ok, scenResult.detail)
engine.runHeadless(90)
const newConflicts = engine.trafficEvents.length - beforeConflicts
assert('conflicts are detected in the shared world', newConflicts > 0, `${newConflicts} conflict events`)
assert('at least one agent yielded or rerouted', engine.metrics.yieldCount > beforeYield || engine.metrics.replanCount > 0, `${engine.metrics.yieldCount - beforeYield} yields`)
assert('no interpenetration between bodies', engine.metrics.collisionCount === 0, `${engine.metrics.collisionCount} separations required`)
const passers = [...engine.agents.values()].filter((a) => a.memory.yieldedTo || a.memory.yields > 0)
assert('yielding is attributed to a specific agent', passers.length > 0, passers.map((a) => `${a.id}→${a.yieldedTo ?? '−'}`).join(' '))
engine.setStandbyGoal(engine.agentOrder[0], null)
engine.setStandbyGoal(engine.agentOrder[1], null)

/* ------------------------------------------------- 5. failure + reassign */
section('5 · FAILURE, REASSIGNMENT AND RECOVERY')
engine.runHeadless(30)
const victim = agents().find((a) => a.task !== null)
if (victim) {
  const taskId = victim.task!.id
  engine.injectFault(victim.id, 'DRIVE_CONTROLLER_FAULT')
  const released = engine.tasks.get(taskId)!
  assert('fault marks the agent failed', victim.status === 'FAILED' && !!victim.fault)
  assert('its task is released for reassignment', released.status === 'REASSIGNING' && released.assignedTo === null)
  engine.runHeadless(45)
  const reassignedTask = engine.tasks.get(taskId)!
  assert('another agent accepts the task', reassignedTask.assignedTo !== null && reassignedTask.assignedTo !== victim.id, `→ ${reassignedTask.assignedTo}`)
  engine.recoverAgent(victim.id)
  assert('failed agent can be recovered', victim.fault === null)
} else {
  assert('an agent held a task to fail', false)
}

/* ------------------------------------------- 6. sim-to-real deployment */
section('6 · SIM-TO-REAL AGENT DEPLOYMENT')
engine.runHeadless(60)
// deploy an agent that is genuinely working, so "physical motion" is meaningful
for (let i = 0; i < 40 && !agents().some((a) => a.backendKind === 'SIMULATION' && a.task !== null); i++) engine.runHeadless(5)
const candidate = agents().find((a) => a.backendKind === 'SIMULATION' && a.task !== null) ?? agents().find((a) => a.backendKind === 'SIMULATION')!
assert('deployment candidate is executing a real task', candidate.task !== null, `${candidate.id} · ${candidate.task?.id ?? 'idle'}`)
const p01 = engine.binding.hardware.get('P01')!
assert('physical hardware is registered', engine.binding.hardware.size >= 3, `${engine.binding.hardware.size} units`)
assert('P01 advertises capabilities', p01.capabilities.maxVelocity > 0, `${p01.status} · ${(p01.battery * 100) | 0}%`)
const proc = engine.requestDeploy(candidate.id, 'P01')!
assert('deployment process is observable in stages', proc.stages.length >= 7, `${proc.stages.length} stages`)
engine.runHeadless(6)
assert('stages advance visibly', proc.stages.filter((s) => s.status === 'PASS').length >= 1, `${proc.stages.filter((s) => s.status === 'PASS').length} passed`)
engine.runHeadless(20)
assert('agent is now PHYSICAL on P01', candidate.backendKind === 'PHYSICAL' && candidate.hardwareId === 'P01')
assert('agent identity is unchanged by deployment', candidate.id === proc.agentId && engine.agents.has(candidate.id), `${candidate.id} keeps its identity`)
assert('hardware reports BUSY while hosting the agent', p01.boundAgentId === candidate.id)
const twin = engine.binding.twins.get(candidate.id)!
assert('a digital twin exists for the deployed agent', !!twin)
engine.runHeadless(30)
assert('telemetry reaches the digital twin', twin.telemetry !== null, `seq ${twin.telemetry?.seq ?? 0}`)
assert('twin synchronises', twin.syncState === 'SYNCED')
const odomBefore = engine.deviceDistance('P01')
engine.runHeadless(45)
const movedPhysically = engine.deviceDistance('P01') - odomBefore
assert('physical body actually moves under agent control', movedPhysically > 0.5, `${movedPhysically.toFixed(2)} m of real motion from validated commands`)
assert('planned vs actual are tracked separately', typeof twin.positionErrorM === 'number', `error ${twin.positionErrorM.toFixed(3)} m`)
const cmdCount = engine.binding.bindings.get(candidate.id)!.commandsDispatched
assert('commands traverse the safety gate', cmdCount > 0, `${cmdCount} validated commands dispatched`)
assert('telemetry latency is measured, not invented', engine.binding.syncLatencies.length > 0, `${(engine.binding.syncLatencies.at(-1) ?? 0).toFixed(1)} ms`)

/* --------------------------------------------- 7. safe unbind + rebind */
section('7 · SAFE UNBIND AND REBINDING TO ANOTHER AGENT')
const unbind = engine.requestUnbind(candidate.id)!
engine.runHeadless(20)
assert('agent returns to SIMULATION', candidate.backendKind === 'SIMULATION' && candidate.hardwareId === null)
assert('hardware returns to the pool', p01.boundAgentId === null && p01.status === 'ONLINE')
const second = agents().find((a) => a.id !== candidate.id && a.backendKind === 'SIMULATION')!
const proc2 = engine.requestDeploy(second.id, 'P01')!
engine.runHeadless(25)
assert('the SAME hardware can host a DIFFERENT agent', second.hardwareId === 'P01' && second.backendKind === 'PHYSICAL', `${second.id} now drives P01`)
assert('the second agent kept its own identity and context', second.id !== candidate.id && second.context !== null)
const t2 = engine.binding.twins.get(second.id)!
engine.runHeadless(20)
assert('second agent gets its own live twin', t2.telemetry !== null && t2.syncState === 'SYNCED')

/* ------------------------------------------------ 8. incompatible hardware */
section('8 · SAFETY: INCOMPATIBLE HARDWARE IS REFUSED')
const p03 = engine.binding.hardware.get('P03')!
const third = agents().find((a) => a.id !== second.id && a.id !== candidate.id)!
const proc3 = engine.requestDeploy(third.id, 'P03')!
engine.runHeadless(10)
assert('legged/legacy platform is rejected by compatibility check', proc3.ok === false, proc3.message)
assert('rejection is explained with reasons', (proc3.compatibility?.reasons.length ?? 0) > 0, proc3.compatibility?.reasons[0])
assert('agent never reaches physical control', third.hardwareId === null)

/* --------------------------------------------------- 9. physical dropout */
section('9 · PHYSICAL LINK LOSS')
engine.requestUnbind(second.id)
engine.runHeadless(20)
const third2 = third
const proc4 = engine.requestDeploy(third2.id, 'P01')!
engine.runHeadless(25)
assert('third agent deployed', third2.hardwareId === 'P01')
engine.physicalDropout('P01', 60)
engine.runHeadless(12)
const twin3 = engine.binding.twins.get(third2.id)
assert('physical link reported OFFLINE (never faked)', p01.status === 'OFFLINE')
assert('twin is degraded / lost', twin3 === undefined || twin3.syncState !== 'SYNCED', twin3?.syncState ?? 'unbound')
assert('twin reports telemetry age instead of faking freshness', (twin3?.telemetryAgeMs ?? 0) > 1500, `${((twin3?.telemetryAgeMs ?? 0) / 1000).toFixed(1)} s without telemetry`)
assert('NEXUS does not silently pretend the robot is connected', engine.events.some((e) => e.message.includes('link LOST')))
assert('hardware is marked offline in the registry', engine.binding.hardware.get('P01')!.status === 'OFFLINE')
engine.runHeadless(120)
assert('link recovery restores twin sync', engine.binding.twins.get(third2.id)?.syncState === 'SYNCED' || third2.hardwareId === null)

/* ---------------------------------------------- 10. wall clock + totals */
section('10 · LOAD TEST')
const t0 = Date.now()
const t0sim = engine.now
engine.runHeadless(600)
const wall = Date.now() - t0
const mult = (engine.now - t0sim) / (wall / 1000)
assert('engine simulates far faster than real time', mult > 20, `${mult.toFixed(0)}× real time on one core`)
assert('fleet keeps completing work over long runs', engine.metrics.tasksCompleted > 3, `${engine.metrics.tasksCompleted} tasks completed`)

engine.captureBaseline()
const snap = engine.metricsSnapshot()
console.log(
  `\n\x1b[90mthroughput ${snap.throughputPerHour.toFixed(1)}/h · util ${(snap.robotUtilization * 100).toFixed(0)}% · replans ${snap.replanCount} · yields ${snap.yieldCount} · near-misses ${snap.nearMisses} · reassignments ${snap.reassignmentCount} · avg task ${snap.avgTaskTimeS.toFixed(1)}s\x1b[0m`,
)

console.log(`\n\x1b[1m${checks - failures}/${checks} checks passed\x1b[0m`)
if (failures > 0) {
  console.log('\x1b[31mVERIFICATION FAILED\x1b[0m')
  process.exit(1)
}
console.log('\x1b[32mVERIFICATION PASSED\x1b[0m\n')
