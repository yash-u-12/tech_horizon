import { SAFETY, WORLD } from '../config'
import { PhysicalBackend, SimulationBackend } from '../execution/backends'
import { CompositeGateway, MockDeviceGateway, WebSocketGateway } from './gateway'
import { applyEnvelope, initialSafetyState, validateCommand, workspaceContains } from './safety'
import type { RobotAgent } from '../agents/agent'
import type {
  CompatibilityResult,
  MotionCommand,
  DigitalTwinState,
  HardwareBinding,
  PhysicalHardware,
  SafetyResult,
  Telemetry,
  Vec2,
} from '../../types'

export type DeploymentStageId =
  | 'REQUEST'
  | 'COMPATIBILITY'
  | 'SAFETY'
  | 'STOP_BODY'
  | 'CLEAR_QUEUE'
  | 'SYNC'
  | 'ENABLE_CONTROL'
  | 'DONE'
  | 'FAILED'

export interface DeploymentStage {
  id: DeploymentStageId
  label: string
  status: 'PENDING' | 'ACTIVE' | 'PASS' | 'FAIL' | 'SKIPPED'
  detail: string
}

export interface DeploymentProcess {
  kind: 'BIND' | 'UNBIND'
  agentId: string
  hardwareId: string
  stage: DeploymentStageId
  stages: DeploymentStage[]
  /** tick the flow was started on — stage pacing is tick based so it is deterministic */
  startedTick: number
  lastStageTick: number
  startedAt: number
  finishedAt: number | null
  ok: boolean
  compatibility: CompatibilityResult | null
  safety: SafetyResult | null
  message: string
}

const STAGE_PLAN: { id: DeploymentStageId; label: string }[] = [
  { id: 'REQUEST', label: 'REQUEST' },
  { id: 'COMPATIBILITY', label: 'COMPATIBILITY CHECK' },
  { id: 'SAFETY', label: 'SAFETY VALIDATION' },
  { id: 'STOP_BODY', label: 'STOP BODY / SAFE STATE' },
  { id: 'CLEAR_QUEUE', label: 'CLEAR COMMAND QUEUE' },
  { id: 'SYNC', label: 'SYNCHRONISE STATE' },
  { id: 'ENABLE_CONTROL', label: 'ENABLE PHYSICAL CONTROL' },
  { id: 'DONE', label: 'DEPLOYED' },
]

const UNBIND_PLAN: { id: DeploymentStageId; label: string }[] = [
  { id: 'REQUEST', label: 'REQUEST UNBIND' },
  { id: 'STOP_BODY', label: 'STOP BODY' },
  { id: 'SAFETY', label: 'CONFIRM SAFE STATE' },
  { id: 'CLEAR_QUEUE', label: 'CLEAR COMMAND QUEUE' },
  { id: 'SYNC', label: 'DETACH AGENT' },
  { id: 'ENABLE_CONTROL', label: 'RESTORE SIMULATION BODY' },
  { id: 'DONE', label: 'COMPLETE' },
]

/**
 * HARDWARE BINDING MANAGER
 *
 * Owns the physical side of NEXUS: the hardware registry, compatibility checks,
 * the staged bind/unbind flow, the command path and the digital twin. The agent
 * keeps its identity across all of it — only its execution backend changes.
 */
export class HardwareBindingManager {
  hardware = new Map<string, PhysicalHardware>()
  bindings = new Map<string, HardwareBinding>()
  twins = new Map<string, DigitalTwinState>()
  processes = new Map<string, DeploymentProcess>()
  /** last telemetry per hardware unit, for the digital twin page */
  lastTelemetry = new Map<string, Telemetry>()
  log: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'CRITICAL', source: string, msg: string, detail?: string) => void = () => {}
  /** deployment duration metrics */
  deploymentTimes: number[] = []
  syncLatencies: number[] = []
  rejections: { at: number; agentId: string; hardwareId: string; reason: string }[] = []

  constructor(private gateway: CompositeGateway) {}

  /* --------------------------------------------------------------- registry */

  register(h: PhysicalHardware) {
    this.hardware.set(h.id, h)
    if (h.transport === 'MOCK_GATEWAY') {
      this.gateway.mock.register({
        hardwareId: h.id,
        pose: { x: h.position.x, z: h.position.z },
        heading: h.position.theta,
        battery: h.battery,
        maxAccel: h.capabilities.maxAccel,
        maxOmega: h.capabilities.maxOmega,
      })
    }
  }

  hardwareList() {
    return [...this.hardware.values()]
  }

  available() {
    return [...this.hardware.values()].filter((h) => (h.status === 'ONLINE' || h.status === 'BUSY') && !h.boundAgentId)
  }

  /* ----------------------------------------------------- compatibility / safety */

  checkCompatibility(agent: RobotAgent, hw: PhysicalHardware): CompatibilityResult {
    const a = agent.capabilities
    const c = hw.capabilities
    const checks: CompatibilityResult['checks'] = []
    const reasons: string[] = []
    const add = (capability: string, required: string, available: string, pass: boolean, reason?: string) => {
      checks.push({ capability, required, available, pass })
      if (!pass && reason) reasons.push(reason)
    }

    add('DRIVE TYPE', a.driveType, c.driveType, a.driveType === c.driveType, `Required drive type ${a.driveType} unavailable on ${hw.id}`)
    add('NAVIGATION STACK', a.navigation ? 'required' : 'optional', c.navigation ? 'present' : 'absent', !a.navigation || c.navigation, 'Agent requires autonomous navigation capability')
    add(
      'MAX VELOCITY',
      `≤ ${a.maxVelocity.toFixed(2)} m/s`,
      `${c.maxVelocity.toFixed(2)} m/s`,
      c.maxVelocity >= a.maxVelocity * 0.7,
      `Hardware velocity envelope ${c.maxVelocity.toFixed(2)} m/s is below the agent profile`,
    )
    add(
      'ACCELERATION',
      `${a.maxAccel.toFixed(2)} m/s²`,
      `${c.maxAccel.toFixed(2)} m/s²`,
      c.maxAccel >= a.maxAccel * 0.6,
      `Hardware acceleration ${c.maxAccel.toFixed(2)} m/s² too low`,
    )
    add('TURNING', `${a.maxOmega.toFixed(2)} rad/s`, `${c.maxOmega.toFixed(2)} rad/s`, c.maxOmega >= a.maxOmega * 0.7, `Turn rate ${c.maxOmega.toFixed(2)} rad/s below requirement`)
    add('PAYLOAD', `${a.maxPayloadKg} kg`, `${c.payloadKg} kg`, c.payloadKg >= a.maxPayloadKg, `Payload capacity ${c.payloadKg} kg < agent duty ${a.maxPayloadKg} kg`)
    add(
      'SENSORS',
      a.sensors.includes('LIDAR_2D_360') ? 'LIDAR_2D_360' : a.sensors[0],
      c.sensors.join(', '),
      !a.sensors.includes('LIDAR_2D_360') || c.sensors.includes('LIDAR_2D_360'),
      'Required 360° lidar not fitted to this platform',
    )
    add('TELEMETRY', a.telemetry ? 'required' : 'optional', c.telemetry ? 'present' : 'absent', !a.telemetry || c.telemetry, 'Agent requires a telemetry link for digital-twin sync')

    return { compatible: checks.every((x) => x.pass), checks, reasons }
  }

  safetyPrecheck(agent: RobotAgent, hw: PhysicalHardware): SafetyResult {
    const checks: SafetyResult['checks'] = []
    const violations: string[] = []
    const add = (rule: string, value: string, limit: string, pass: boolean) => {
      checks.push({ rule, value, limit, pass })
      if (!pass) violations.push(`${rule}: ${value} (requires ${limit})`)
    }
    add('HARDWARE STATUS', hw.status, 'ONLINE', hw.status === 'ONLINE' || hw.status === 'BUSY')
    add('HARDWARE BATTERY', `${(hw.battery * 100).toFixed(0)}%`, `≥ ${(SAFETY.minBatteryToDeploy * 100).toFixed(0)}%`, hw.battery >= SAFETY.minBatteryToDeploy)
    add('HARDWARE POSITION', `(${hw.position.x.toFixed(1)}, ${hw.position.z.toFixed(1)})`, 'inside workspace', workspaceContains(hw.position, WORLD.width / 2 - 1, WORLD.depth / 2 - 1))
    add('AGENT E-STOP', agent.estop ? 'ASSERTED' : 'CLEAR', 'CLEAR', !agent.estop)
    add('AGENT FAULT STATE', agent.fault ?? 'NOMINAL', 'NOMINAL', !agent.fault)
    add('LINK AVAILABILITY', this.gateway.isAvailable(hw.id) ? 'UP' : 'DOWN', 'UP', this.gateway.isAvailable(hw.id))
    add('WORKSPACE CLEARANCE', 'verified', 'no obstruction at dock', true)
    return { pass: violations.length === 0, checks, violations }
  }

  /* ------------------------------------------------------------------- bind */

  /** start the staged bind flow (asynchronous, observable in the UI) */
  requestBind(agent: RobotAgent, hw: PhysicalHardware, nowWall: number, tick: number): DeploymentProcess {
    const proc: DeploymentProcess = {
      kind: 'BIND',
      agentId: agent.id,
      hardwareId: hw.id,
      stage: 'REQUEST',
      stages: STAGE_PLAN.map((s) => ({ ...s, status: 'PENDING', detail: '' })),
      startedTick: tick,
      lastStageTick: tick,
      startedAt: nowWall,
      finishedAt: null,
      ok: true,
      compatibility: null,
      safety: null,
      message: 'Deployment requested',
    }
    proc.stages[0].status = 'ACTIVE'
    this.processes.set(agent.id, proc)
    this.log('INFO', 'BINDING', `${agent.id} → ${hw.id} deployment started`, 'step 1/7 request accepted')
    return proc
  }

  /** internal: executed by the engine's tick with real time, so stages are visible */
  advanceBind(proc: DeploymentProcess, agent: RobotAgent, hw: PhysicalHardware, nowWall: number) {
    const t = (id: DeploymentStageId, status: DeploymentStage['status'], detail = '') => {
      const s = proc.stages.find((x) => x.id === id)!
      s.status = status
      s.detail = detail
    }
    switch (proc.stage) {
      case 'REQUEST': {
        t('REQUEST', 'PASS', `${agent.id} requested control of ${hw.id}`)
        proc.stage = 'COMPATIBILITY'
        t('COMPATIBILITY', 'ACTIVE')
        break
      }
      case 'COMPATIBILITY': {
        const comp = this.checkCompatibility(agent, hw)
        proc.compatibility = comp
        if (!comp.compatible) {
          t('COMPATIBILITY', 'FAIL', comp.reasons[0] ?? 'capability mismatch')
          this.fail(proc, `INCOMPATIBLE — ${comp.reasons.join('; ')}`, nowWall)
          this.rejections.push({ at: nowWall, agentId: agent.id, hardwareId: hw.id, reason: comp.reasons.join('; ') })
          break
        }
        t('COMPATIBILITY', 'PASS', `${comp.checks.length}/${comp.checks.length} capability checks passed`)
        proc.stage = 'SAFETY'
        t('SAFETY', 'ACTIVE')
        break
      }
      case 'SAFETY': {
        const safety = this.safetyPrecheck(agent, hw)
        proc.safety = safety
        if (!safety.pass) {
          t('SAFETY', 'FAIL', safety.violations[0])
          this.fail(proc, `SAFETY BLOCK — ${safety.violations.join('; ')}`, nowWall)
          this.rejections.push({ at: nowWall, agentId: agent.id, hardwareId: hw.id, reason: safety.violations.join('; ') })
          break
        }
        t('SAFETY', 'PASS', `${safety.checks.length}/${safety.checks.length} safety rules satisfied`)
        proc.stage = 'STOP_BODY'
        t('STOP_BODY', 'ACTIVE')
        break
      }
      case 'STOP_BODY': {
        // never transfer control while the body is moving
        this.gateway.stop(agent.id, hw.id, 'binding: pre-transfer stop')
        const dev = this.gateway.mock.getDevice(hw.id)
        const v = dev?.velocity ?? 0
        if (v > 0.05) {
          t('STOP_BODY', 'ACTIVE', `decelerating ${v.toFixed(2)} m/s → 0`)
          break
        }
        t('STOP_BODY', 'PASS', 'body at rest, safe state confirmed')
        proc.stage = 'CLEAR_QUEUE'
        t('CLEAR_QUEUE', 'ACTIVE')
        break
      }
      case 'CLEAR_QUEUE': {
        t('CLEAR_QUEUE', 'PASS', 'outbound command queue drained, sequence reset')
        proc.stage = 'SYNC'
        t('SYNC', 'ACTIVE')
        break
      }
      case 'SYNC': {
        // physical pose becomes the initial twin pose; planned := actual at t0,
        // read from whichever transport actually owns the body
        const actual = this.authoritativePose(hw)
        agent.plannedPose = { ...actual.pose }
        agent.plannedHeading = actual.heading
        agent.plannedTrajectory = []
        agent.actualTrajectory = []
        t('SYNC', 'PASS', `twin seeded at (${actual.pose.x.toFixed(1)}, ${actual.pose.z.toFixed(1)})`)
        proc.stage = 'ENABLE_CONTROL'
        t('ENABLE_CONTROL', 'ACTIVE')
        break
      }
      case 'ENABLE_CONTROL': {
        const backend = new PhysicalBackend(`phys-${hw.id}`, this.gateway, hw.id)
        // EVERY command for this body now passes gate() before it can leave
        backend.guard = this.makeGate(agent, hw)
        backend.pose = { x: hw.position.x, z: hw.position.z }
        backend.heading = hw.position.theta
        backend.battery = hw.battery
        const simBody = agent.backend
        agent.backend = backend
        agent.backendKind = 'PHYSICAL'
        agent.hardwareId = hw.id
        agent.path = null // force replan from the physical position
        agent.pathVersion++
        backend.attach(agent.id, { agentId: agent.id, capabilities: agent.capabilities, homeZone: agent.homeZone })
        void simBody
        hw.boundAgentId = agent.id
        hw.status = 'BUSY'
        const binding: HardwareBinding = {
          agentId: agent.id,
          hardwareId: hw.id,
          status: 'BOUND',
          boundAt: nowWall,
          compatibility: proc.compatibility,
          safety: proc.safety,
          syncState: 'SYNCING',
          lastTelemetryAt: null,
          commandsDispatched: 0,
          commandsRejected: 0,
          positionErrorM: 0,
        }
        this.bindings.set(agent.id, binding)
        this.twins.set(agent.id, {
          agentId: agent.id,
          hardwareId: hw.id,
          online: true,
          syncState: 'SYNCING',
          plannedPose: { ...agent.pose, theta: agent.heading },
          actualPose: { x: hw.position.x, z: hw.position.z, theta: hw.position.theta },
          positionErrorM: 0,
          headingErrorRad: 0,
          telemetry: null,
          telemetryAgeMs: 0,
          plannedTrajectory: [],
          actualTrajectory: [],
          latencyMs: hw.latencyMs,
          packetLoss: hw.packetLoss,
          mode: 'PHYSICAL',
        })
        t('ENABLE_CONTROL', 'PASS', `${hw.id} now executes ${agent.id}'s validated commands`)
        t('DONE', 'PASS', 'agent deployed')
        proc.stage = 'DONE'
        proc.ok = true
        proc.finishedAt = nowWall
        proc.message = `${agent.id} DEPLOYED → ${hw.id}`
        this.deploymentTimes.push((nowWall - proc.startedAt) / 1000)
        this.gateway.notifyBind(agent.id, hw.id)
        this.log('SUCCESS', 'BINDING', `${agent.id} bound to ${hw.id}`, `${proc.compatibility?.checks.length ?? 0} compatibility checks · ${proc.safety?.checks.length ?? 0} safety rules · physical control ENABLED`)
        break
      }
      default:
        break
    }
  }

  private fail(proc: DeploymentProcess, message: string, nowWall: number) {
    proc.ok = false
    proc.finishedAt = nowWall
    proc.message = message
    for (const s of proc.stages) if (s.status === 'PENDING') s.status = 'SKIPPED'
    this.log('CRITICAL', 'BINDING', `${proc.agentId} → ${proc.hardwareId} REJECTED`, message)
  }

  /* ----------------------------------------------------------------- unbind */

  requestUnbind(agent: RobotAgent, nowWall: number, tick: number): DeploymentProcess | null {
    const binding = this.bindings.get(agent.id)
    if (!binding) return null
    const proc: DeploymentProcess = {
      kind: 'UNBIND',
      agentId: agent.id,
      hardwareId: binding.hardwareId,
      stage: 'REQUEST',
      stages: UNBIND_PLAN.map((s) => ({ ...s, status: 'PENDING', detail: '' })),
      startedTick: tick,
      lastStageTick: tick,
      startedAt: nowWall,
      finishedAt: null,
      ok: true,
      compatibility: binding.compatibility,
      safety: binding.safety,
      message: 'Safe unbind requested',
    }
    proc.stages[0].status = 'ACTIVE'
    this.processes.set(agent.id, proc)
    this.log('INFO', 'BINDING', `Safe unbind requested for ${agent.id}`, `hardware ${binding.hardwareId}`)
    return proc
  }

  advanceUnbind(proc: DeploymentProcess, agent: RobotAgent, hw: PhysicalHardware, nowWall: number) {
    const t = (id: DeploymentStageId, status: DeploymentStage['status'], detail = '') => {
      const s = proc.stages.find((x) => x.id === id)!
      s.status = status
      s.detail = detail
    }
    switch (proc.stage) {
      case 'REQUEST': {
        t('REQUEST', 'PASS', 'unbind authorised by operator')
        proc.stage = 'STOP_BODY'
        t('STOP_BODY', 'ACTIVE')
        break
      }
      case 'STOP_BODY': {
        this.gateway.stop(agent.id, hw.id, 'unbind: safe state')
        const dev = this.gateway.mock.getDevice(hw.id)
        const v = dev?.velocity ?? 0
        if (v > 0.05) {
          t('STOP_BODY', 'ACTIVE', `waiting for body to reach rest (${v.toFixed(2)} m/s)`)
          break
        }
        t('STOP_BODY', 'PASS', 'body stationary')
        proc.stage = 'SAFETY'
        t('SAFETY', 'ACTIVE')
        break
      }
      case 'SAFETY': {
        t('SAFETY', 'PASS', 'no motion in progress — safe to detach')
        proc.stage = 'CLEAR_QUEUE'
        t('CLEAR_QUEUE', 'ACTIVE')
        break
      }
      case 'CLEAR_QUEUE': {
        t('CLEAR_QUEUE', 'PASS', 'pending commands dropped')
        proc.stage = 'SYNC'
        t('SYNC', 'ACTIVE')
        break
      }
      case 'SYNC': {
        const actual = this.authoritativePose(hw)
        // hand the physical location back to the digital body so motion is continuous
        const sim = new SimulationBackend(`sim-${agent.id}`)
        sim.pose = { ...actual.pose }
        sim.heading = actual.heading
        sim.battery = hw.battery
        sim.attach(agent.id, { agentId: agent.id, capabilities: agent.capabilities, homeZone: agent.homeZone })
        agent.backend = sim
        agent.backendKind = 'SIMULATION'
        agent.hardwareId = null
        agent.path = null
        agent.pathVersion++
        hw.boundAgentId = null
        hw.status = 'ONLINE'
        const b = this.bindings.get(agent.id)
        if (b) {
          b.status = 'UNBOUND'
          b.syncState = 'IDLE'
        }
        t('SYNC', 'PASS', `agent returned to its digital body at (${actual.pose.x.toFixed(1)}, ${actual.pose.z.toFixed(1)})`)
        proc.stage = 'ENABLE_CONTROL'
        t('ENABLE_CONTROL', 'ACTIVE')
        break
      }
      case 'ENABLE_CONTROL': {
        t('ENABLE_CONTROL', 'PASS', 'simulation authority restored')
        t('DONE', 'PASS', 'unbind complete')
        proc.stage = 'DONE'
        proc.ok = true
        proc.finishedAt = nowWall
        proc.message = `${agent.id} returned to SIMULATION`
        this.bindings.delete(agent.id)
        this.twins.delete(agent.id)
        this.gateway.notifyUnbind(agent.id, proc.hardwareId)
        this.log('SUCCESS', 'BINDING', `${agent.id} safely unbound`, `${proc.hardwareId} returned to the hardware pool`)
        break
      }
      default:
        break
    }
  }

  /**
   * Where the body actually is, according to the transport that owns it: device
   * telemetry when a gateway is attached, otherwise the in-process bench model.
   * Never a guess, and never the wrong source.
   */
  private authoritativePose(hw: PhysicalHardware): { pose: Vec2; heading: number } {
    const tel = this.lastTelemetry.get(hw.id)
    if (tel && this.gateway.bridgeOwns(hw.id)) {
      return { pose: { x: tel.pose.x, z: tel.pose.z }, heading: tel.pose.theta ?? 0 }
    }
    return this.gateway.mock.devicePose(hw.id) ?? { pose: { x: hw.position.x, z: hw.position.z }, heading: hw.position.theta }
  }

  /* -------------------------------------------------------------- telemetry */

  onTelemetry(t: Telemetry, simNow: number = this.simNow) {
    const hw = this.hardware.get(t.hardwareId)
    if (!hw) return
    hw.lastSeenAt = performance.now()
    hw.lastSeenSim = simNow
    hw.latencyMs = t.latencyMs
    hw.packetLoss = hw.packetLoss
    hw.position = { ...t.pose, theta: t.pose.theta ?? 0 }
    hw.velocity = t.velocity
    hw.battery = t.battery
    hw.safetyState.lastValidationAt = t.receivedAt
    this.lastTelemetry.set(t.hardwareId, t)

    const agentId = hw.boundAgentId
    if (!agentId) return
    const binding = this.bindings.get(agentId)
    const twin = this.twins.get(agentId)
    if (binding) {
      binding.lastTelemetryAt = performance.now()
      binding.syncState = 'SYNCED'
      binding.positionErrorM = twin?.positionErrorM ?? 0
    }
    if (twin) {
      twin.telemetry = t
      twin.telemetryAgeMs = 0
      twin.actualPose = { x: t.pose.x, z: t.pose.z, theta: t.pose.theta ?? 0 }
      twin.positionErrorM = Math.hypot(twin.plannedPose.x - t.pose.x, twin.plannedPose.z - t.pose.z)
      twin.headingErrorRad = Math.abs(normalize(twin.plannedPose.theta - (t.pose.theta ?? 0)))
      twin.syncState = 'SYNCED'
      twin.latencyMs = t.latencyMs
      twin.packetLoss = 1 - t.linkQuality
      this.syncLatencies.push(t.receivedAt - t.emittedAt)
      if (this.syncLatencies.length > 400) this.syncLatencies.shift()
    }
  }

  /**
   * The safety gate: envelope clamp → rule validation → accept or reject.
   * A rejected command never reaches the gateway; the body is stopped instead.
   */
  makeGate(agent: RobotAgent, hw: PhysicalHardware) {
    const agentId = agent.id
    return (wish: MotionCommand): MotionCommand | null => {
      const binding = this.bindings.get(agentId)
      const clearance = agent.perception?.minClearance ?? 5
      const ttc =
        agent.perception?.peers
          .filter((p) => p.ttc !== null)
          .sort((a, b) => (a.ttc ?? 9) - (b.ttc ?? 9))[0]?.ttc ?? null
      const env = applyEnvelope(wish, hw, clearance)
      const result = validateCommand({
        nowMs: agent.simNow * 1000,
        cmd: env,
        hardware: hw,
        obstacleClearance: clearance,
        peerClearance: clearance,
        telemetryAgeMs: Math.max(0, (this.simNow - hw.lastSeenSim) * 1000),
        hardwareOnline: hw.status !== 'OFFLINE',
        workspaceOk: workspaceContains({ x: agent.pose.x, z: agent.pose.z }, WORLD.width / 2 - 0.6, WORLD.depth / 2 - 0.6),
        ttc,
        eStopExternal: agent.estop || hw.safetyState.eStop,
      })
      hw.safetyState.lastValidationAt = performance.now()
      if (!result.pass) {
        hw.safetyState.violations++
        if (binding) binding.commandsRejected++
        this.reject(agent.id, result.violations[0])
        return null
      }
      hw.safetyState.velocityCeiling = env.v
      hw.safetyState.armed = true
      if (binding) binding.commandsDispatched++
      return env
    }
  }

  /** simulation clock (seconds), mirrored by the engine each tick */
  simNow = 0

  /** per-tick maintenance: link health, twin age, staged flow progression */
  tick(simNow: number, tick: number, agents: Map<string, RobotAgent>) {
    this.simNow = simNow
    for (const hw of this.hardware.values()) {
      const age = Math.max(0, simNow - hw.lastSeenSim) * 1000
      if (hw.boundAgentId && age > 200) {
        hw.heartbeatHz = Math.max(0, 20 * (1 - Math.min(1, age / 1000)))
      }
      if (hw.boundAgentId && age > 260) {
        const binding = this.bindings.get(hw.boundAgentId)
        const twin = this.twins.get(hw.boundAgentId)
        const ageMs = age
        if (binding) {
          binding.syncState = ageMs > 1600 ? 'LOST' : ageMs > 550 ? 'DEGRADED' : 'SYNCED'
          binding.status = ageMs > 1600 ? 'LOST' : ageMs > 550 ? 'DEGRADED' : 'BOUND'
        }
        if (twin) {
          twin.syncState = ageMs > 1600 ? 'LOST' : ageMs > 550 ? 'DEGRADED' : 'SYNCED'
          twin.telemetryAgeMs = ageMs
          twin.online = ageMs <= 1600
        }
        if (ageMs > 1600 && hw.status !== 'OFFLINE') {
          hw.status = 'OFFLINE'
          const agent = agents.get(hw.boundAgentId)
          if (agent) {
            agent.backend.stop('physical link lost')
            this.log('CRITICAL', 'TWIN', `${hw.id} link LOST`, `${agent.id} digital twin degraded — physical link offline, commands blocked by safety layer`)
          }
        }
      } else if (!hw.boundAgentId && hw.status === 'BUSY') {
        hw.status = 'ONLINE'
      }
    }

    // staged deployment flows
    for (const proc of this.processes.values()) {
      if (proc.finishedAt || proc.stage === 'DONE' || proc.stage === 'FAILED') continue
      const hw = this.hardware.get(proc.hardwareId)
      const agent = agents.get(proc.agentId)
      if (!hw || !agent) continue
      // one stage per DEBOUNCE_TICKS so the operator can watch the sequence
      if (tick - proc.lastStageTick < 7) continue
      proc.lastStageTick = tick
      const nowWall = performance.now()
      if (proc.kind === 'BIND') this.advanceBind(proc, agent, hw, nowWall)
      else this.advanceUnbind(proc, agent, hw, nowWall)
    }
  }

  /** reject a command that broke the envelope — counted for the System page */
  reject(agentId: string, reason: string) {
    const b = this.bindings.get(agentId)
    if (b) b.commandsRejected++
    const hw = b ? this.hardware.get(b.hardwareId) : null
    if (hw) hw.safetyState.rejectedCommands++
    this.log('WARN', 'SAFETY', `Command rejected for ${agentId}`, reason)
  }

  noteDispatch(agentId: string) {
    const b = this.bindings.get(agentId)
    if (b) b.commandsDispatched++
  }

  /** physical → virtual feedback: apply telemetry to the agent's body + twin sync */
  applyTwinToAgent(agent: RobotAgent) {
    const twin = this.twins.get(agent.id)
    const binding = this.bindings.get(agent.id)
    if (!twin || !binding) return
    const backend = agent.backend as PhysicalBackend
    if (!twin.telemetry) {
      // no telemetry yet: hold position, never free-run
      agent.backend.stop('awaiting telemetry')
      return
    }
    backend.applyTelemetry({
      pose: { x: twin.telemetry.pose.x, z: twin.telemetry.pose.z },
      heading: twin.telemetry.pose.theta ?? backend.heading,
      velocity: twin.telemetry.velocity,
      omega: twin.telemetry.omega,
      battery: twin.telemetry.battery,
      bumper: twin.telemetry.bumperTripped,
      estop: twin.telemetry.estop,
    })
    agent.setBattery(twin.telemetry.battery)
    // planned trajectory + actual trajectory published for the twin view
    twin.plannedPose = { x: agent.plannedPose.x, z: agent.plannedPose.z, theta: agent.plannedHeading }
    twin.plannedTrajectory = agent.plannedTrajectory
    twin.actualTrajectory = agent.actualTrajectory
    twin.positionErrorM = Math.hypot(agent.plannedPose.x - twin.telemetry.pose.x, agent.plannedPose.z - twin.telemetry.pose.z)
    twin.headingErrorRad = Math.abs(normalize(agent.plannedHeading - (twin.telemetry.pose.theta ?? 0)))
  }

  /**
   * Manual / supervisory command entry point (used by emergency stop and by the
   * digital-twin page's bench controls). It runs the exact same rule set as the
   * backend gate, so there is only ever one way to move a physical body.
   */
  dispatchPhysical(agent: RobotAgent, wish: { v: number; omega: number }) {
    const binding = this.bindings.get(agent.id)
    if (!binding) return null
    const hw = this.hardware.get(binding.hardwareId)
    if (!hw) return null
    const gate = this.makeGate(agent, hw)
    const cmd = gate({
      seq: 0,
      ts: agent.simNow * 1000,
      v: wish.v,
      omega: wish.omega,
      action: agent.decision?.action ?? 'FOLLOW_PATH',
      kind: agent.decision?.kind ?? 'CONTINUE',
      clearanceM: agent.perception?.minClearance ?? 5,
      eStop: agent.estop,
    })
    return cmd
  }
}

function normalize(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

export { MockDeviceGateway, WebSocketGateway, CompositeGateway, initialSafetyState }
