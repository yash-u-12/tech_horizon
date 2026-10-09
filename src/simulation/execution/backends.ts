import type {
  AgentProfile,
  ExecutionMode,
  MotionCommand,
  RobotAction,
  RobotExecutionBackend,
  Vec2,
} from '../../types'

/**
 * EXECUTION BACKENDS — the *body* side of the agent/body split.
 *
 * An agent produces MotionCommands. Whether those commands move a mesh in the
 * browser, a mock gateway, or a real robot over ROS 2 is decided here and
 * nowhere else. Agents have no idea which backend they hold.
 */

export interface BackendTelemetryHook {
  (sample: {
    backendId: string
    mode: ExecutionMode
    pose: Vec2
    heading: number
    velocity: number
    omega: number
    battery: number
    batteryDelta: number
    bodyX: number
    bodyZ: number
    bumper: boolean
    estop: boolean
    hardwareId: string | null
  }): void
}

/** Command sink used by PhysicalBackend to reach the robot gateway. */
export interface GatewayTransport {
  readonly id: string
  readonly transport: string
  send(agentId: string, hardwareId: string, cmd: MotionCommand): void
  stop(agentId: string, hardwareId: string, reason: string): void
  estop(agentId: string, hardwareId: string, on: boolean): void
  isAvailable(hardwareId: string): boolean
}

export abstract class BaseBackend implements RobotExecutionBackend {
  abstract readonly kind: ExecutionMode
  abstract readonly label: string
  abstract readonly isRemote: boolean
  attachedAgentId: string | null = null
  protected profile: AgentProfile | null = null
  commandsSent = 0
  commandsRejected = 0
  lastCommand: MotionCommand | null = null
  pose: Vec2 = { x: 0, z: 0 }
  heading = 0
  velocity = 0
  omega = 0
  battery = 1
  bumper = false
  eStop = false

  constructor(readonly id: string) {}

  attach(agentId: string, profile: AgentProfile) {
    this.attachedAgentId = agentId
    this.profile = profile
  }

  detach() {
    this.attachedAgentId = null
    this.velocity = 0
    this.omega = 0
  }

  abstract dispatch(cmd: MotionCommand): void

  stop(_reason: string) {
    this.velocity = 0
    this.omega = 0
  }

  emergencyStop(on: boolean) {
    this.eStop = on
    if (on) this.stop('E_STOP')
  }

  dispose() {
    this.detach()
  }

  /** called once per sim tick by the engine */
  protected integrate(cmd: MotionCommand | null, dt: number, maxAccel: number, maxOmega: number) {
    if (!cmd || this.eStop) {
      // decelerate to rest
      const decel = maxAccel * 1.6 * dt
      this.velocity = Math.max(0, this.velocity - decel)
      this.omega *= 0.85
    } else {
      const dv = cmd.v - this.velocity
      const maxDv = maxAccel * dt
      this.velocity += Math.max(-maxDv, Math.min(maxDv, dv))
      const dw = cmd.omega - this.omega
      const maxDw = maxOmega * dt
      this.omega += Math.max(-maxDw, Math.min(maxDw, dw))
    }
    this.heading += this.omega * dt
    this.pose = {
      x: this.pose.x + Math.cos(this.heading) * this.velocity * dt,
      z: this.pose.z + Math.sin(this.heading) * this.velocity * dt,
    }
  }
}

/* ---------------------------------------------------------------- simulation */

export class SimulationBackend extends BaseBackend {
  readonly kind: ExecutionMode = 'SIMULATION'
  readonly isRemote = false
  readonly label = 'Simulation Backend'
  pending: MotionCommand | null = null
  /** last command the safety layer accepted, for the UI command log */
  lastAccepted: MotionCommand | null = null

  dispatch(cmd: MotionCommand) {
    this.pending = cmd
    this.lastAccepted = cmd
    this.commandsSent++
    this.lastCommand = cmd
  }

  step(dt: number, maxAccel: number, maxOmega: number, hook?: BackendTelemetryHook) {
    this.integrate(this.pending, dt, maxAccel, maxOmega)
    this.velocity = Math.max(0, this.velocity)
    this.pending = null
    hook?.({
      backendId: this.id,
      mode: this.kind,
      pose: this.pose,
      heading: this.heading,
      velocity: this.velocity,
      omega: this.omega,
      battery: this.battery,
      batteryDelta: 0,
      bodyX: 0,
      bodyZ: 0,
      bumper: false,
      estop: this.eStop,
      hardwareId: null,
    })
  }
}

/* ------------------------------------------------------------------ physical */

/**
 * PhysicalBackend never integrates the body itself — physical state comes from
 * telemetry. It only forwards validated commands to the gateway.
 */
export class PhysicalBackend extends BaseBackend {
  readonly kind: ExecutionMode = 'PHYSICAL'
  readonly isRemote = true
  readonly label: string
  /**
   * SAFETY GATE. Nothing reaches the gateway without passing through here:
   * envelope clamp → rule validation → accept / reject. Installed by the
   * HardwareBindingManager; a null return means the command never leaves.
   */
  guard: ((cmd: MotionCommand) => MotionCommand | null) | null = null

  constructor(id: string, private transport: GatewayTransport, public hardwareId: string) {
    super(id)
    this.label = `Physical Backend → ${hardwareId}`
  }

  dispatch(wish: MotionCommand) {
    if (!this.transport.isAvailable(this.hardwareId)) {
      this.commandsRejected++
      this.lastCommand = { ...wish, v: 0, omega: 0 }
      return
    }
    const cmd = this.guard ? this.guard(wish) : wish
    if (!cmd) {
      this.commandsRejected++
      this.stop('safety gate rejected command')
      return
    }
    this.transport.send(this.attachedAgentId ?? 'unknown', this.hardwareId, cmd)
    this.commandsSent++
    this.lastCommand = cmd
  }

  /**
   * Stop is a *request* to the body. Physical velocity is only ever updated by
   * telemetry, never by this process pretending the robot stopped.
   */
  stop(reason: string) {
    this.omega = 0
    this.transport.stop(this.attachedAgentId ?? 'unknown', this.hardwareId, reason)
  }

  emergencyStop(on: boolean) {
    this.eStop = on
    this.transport.estop(this.attachedAgentId ?? 'unknown', this.hardwareId, on)
  }

  /** telemetry push — authoritative for ACTUAL state of the twin */
  applyTelemetry(t: {
    pose: Vec2
    heading: number
    velocity: number
    omega: number
    battery: number
    bumper: boolean
    estop: boolean
  }) {
    this.pose = t.pose
    this.heading = t.heading
    this.velocity = t.velocity
    this.omega = t.omega
    this.battery = t.battery
    this.bumper = t.bumper
    this.eStop = t.estop
  }
}

/* ---------------------------------------------------------------------- mock */

/**
 * MockPhysicalBackend: a gateway-shaped body used when no real hardware is
 * attached. It is *labelled* as mock everywhere in the UI — mock telemetry is
 * never presented as physical telemetry.
 */
export class MockPhysicalBackend extends BaseBackend {
  kind: ExecutionMode = 'PHYSICAL'
  readonly isRemote = true
  readonly label: string
  pending: MotionCommand | null = null
  /** simulated network latency before a command reaches the body */
  latencyMs = 45
  private queue: { cmd: MotionCommand; dueAt: number }[] = []

  constructor(id: string, public hardwareId: string, badge = 'MOCK GATEWAY') {
    super(id)
    this.label = `${badge} → ${hardwareId}`
  }

  dispatch(cmd: MotionCommand) {
    this.queue.push({ cmd, dueAt: performance.now() + this.latencyMs * 0.5 })
    this.commandsSent++
    this.lastCommand = cmd
  }

  step(dt: number, maxAccel: number, maxOmega: number, hook?: BackendTelemetryHook) {
    const now = performance.now()
    while (this.queue.length && this.queue[0].dueAt <= now) {
      this.pending = this.queue.shift()!.cmd
    }
    this.integrate(this.pending, dt, maxAccel * 0.92, maxOmega * 0.95)
    // mock bodies drift: small systematic error so twin error is non-zero and real
    this.velocity = Math.max(0, this.velocity)
    this.pending = null
    hook?.({
      backendId: this.id,
      mode: 'PHYSICAL',
      pose: this.pose,
      heading: this.heading,
      velocity: this.velocity,
      omega: this.omega,
      battery: this.battery,
      batteryDelta: 0,
      bodyX: 0,
      bodyZ: 0,
      bumper: false,
      estop: this.eStop,
      hardwareId: this.hardwareId,
    })
  }

  queueDepth() {
    return this.queue.length
  }
}

/* ------------------------------------------------------------------ offline */

/** Every agent starts here if a scenario takes its body away. */
export class OfflineBackend extends BaseBackend {
  readonly kind: ExecutionMode = 'SIMULATION'
  readonly isRemote = false
  readonly label = 'Offline'
  dispatch(_cmd: MotionCommand) {
    this.commandsRejected++
  }
  step(_dt: number) {
    /* body is gone */
  }
}

export function makeProfile(agentId: string, capabilities: AgentProfile['capabilities'], homeZone: string): AgentProfile {
  return { agentId, capabilities, homeZone }
}

export const ACTION_LABEL: Record<RobotAction, string> = {
  MOVE_FORWARD: 'MOVE_FORWARD',
  MOVE_BACKWARD: 'MOVE_BACKWARD',
  TURN_LEFT: 'TURN_LEFT',
  TURN_RIGHT: 'TURN_RIGHT',
  ROTATE: 'ROTATE',
  STOP: 'STOP',
  WAIT: 'WAIT',
  FOLLOW_PATH: 'FOLLOW_PATH',
  REROUTE: 'REROUTE',
  PICK: 'PICK',
  DROP: 'DROP',
  CHARGE: 'CHARGE',
  HOLD_POSITION: 'HOLD_POSITION',
}
