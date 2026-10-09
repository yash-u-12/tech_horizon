import type { MotionCommand, PhysicalHardware, Telemetry, Vec2 } from '../../types'
import type { GatewayTransport } from '../execution/backends'

/**
 * ROBOT GATEWAYS
 *
 * The frontend never actuates hardware. Commands travel:
 *
 *   agent → safety envelope → gateway transport → (FastAPI robot gateway → MCU/ROS 2) → body
 *
 * Two transports exist:
 *   • MockDeviceGateway  — an in-process device model, clearly labelled MOCK.
 *   • WebSocketGateway   — the real path into the FastAPI NEXUS gateway
 *                          (/ws/robot). When it is disconnected the UI says
 *                          "PHYSICAL BRIDGE: NOT CONNECTED"; it never pretends.
 */

export interface TelemetrySink {
  (t: Telemetry): void
}

export interface GatewayStatus {
  connected: boolean
  transport: string
  latencyMs: number
  packetLoss: number
  detail: string
}

/* ------------------------------------------------------------- mock device */

interface MockDeviceState {
  hardwareId: string
  pose: Vec2
  heading: number
  velocity: number
  omega: number
  battery: number
  seq: number
  bumper: boolean
  estop: boolean
  motorCurrentA: number
  wheelSlip: number
  lastCmd: MotionCommand | null
  cmdReceivedAt: number
  maxAccel: number
  maxOmega: number
  online: boolean
  distanceM: number
}

/**
 * A device-shaped body model. It behaves like real hardware in the ways that
 * matter for the demo: commands take time to arrive, the body has inertia, the
 * wheels slip a little, odometry drifts, and telemetry is published back on a
 * fixed rate. It is NOT presented as a real robot anywhere in the UI.
 */
export class MockDeviceGateway implements GatewayTransport {
  readonly id = 'gw-mock'
  readonly transport = 'MOCK_GATEWAY'
  private devices = new Map<string, MockDeviceState>()
  private sink: TelemetrySink | null = null
  latencyMs = 48
  packetLoss = 0.0
  /** simulation clock in ms, mirrored by the engine */
  simNowMs = 0
  commandLog: { at: number; hardwareId: string; cmd: MotionCommand; accepted: boolean; reason?: string }[] = []

  register(profile: { hardwareId: string; pose: Vec2; heading: number; battery: number; maxAccel: number; maxOmega: number }) {
    this.devices.set(profile.hardwareId, {
      hardwareId: profile.hardwareId,
      pose: { ...profile.pose },
      heading: profile.heading,
      velocity: 0,
      omega: 0,
      battery: profile.battery,
      seq: 0,
      bumper: false,
      estop: false,
      motorCurrentA: 0.4,
      wheelSlip: 0,
      lastCmd: null,
      cmdReceivedAt: 0,
      maxAccel: profile.maxAccel,
      maxOmega: profile.maxOmega,
      online: true,
      distanceM: 0,
    })
  }

  setOnline(hardwareId: string, online: boolean) {
    const d = this.devices.get(hardwareId)
    if (d) d.online = online
  }

  isAvailable(hardwareId: string) {
    const d = this.devices.get(hardwareId)
    return !!d && d.online
  }

  onTelemetry(sink: TelemetrySink) {
    this.sink = sink
  }

  send(agentId: string, hardwareId: string, cmd: MotionCommand) {
    const d = this.devices.get(hardwareId)
    if (!d || !d.online) {
      this.commandLog.push({ at: performance.now(), hardwareId, cmd, accepted: false, reason: 'device offline' })
      return
    }
    if (d.estop) {
      this.commandLog.push({ at: performance.now(), hardwareId, cmd, accepted: false, reason: 'e-stop asserted' })
      return
    }
    d.lastCmd = cmd
    d.cmdReceivedAt = this.simNowMs
    this.commandLog.push({ at: performance.now(), hardwareId, cmd, accepted: true })
    if (this.commandLog.length > 300) this.commandLog.shift()
    void agentId
  }

  stop(_agentId: string, hardwareId: string, reason: string) {
    const d = this.devices.get(hardwareId)
    if (!d) return
    d.lastCmd = { seq: d.seq++, ts: this.simNowMs, v: 0, omega: 0, action: 'STOP', kind: 'HOLD', clearanceM: 5, eStop: false }
    this.commandLog.push({ at: performance.now(), hardwareId, cmd: d.lastCmd, accepted: true, reason })
  }

  estop(_agentId: string, hardwareId: string, on: boolean) {
    const d = this.devices.get(hardwareId)
    if (d) d.estop = on
  }

  getDevice(hardwareId: string) {
    return this.devices.get(hardwareId) ?? null
  }

  deviceDistance(hardwareId: string) {
    return this.devices.get(hardwareId)?.distanceM ?? 0
  }

  devicePose(hardwareId: string) {
    const d = this.devices.get(hardwareId)
    return d ? { pose: { ...d.pose }, heading: d.heading } : null
  }

  /**
   * Fixed-rate device tick — a physical body advances because telemetry says so.
   * `externallyOwned` lets the composite transport hand a body over to the
   * attached gateway: that gateway then drives it and publishes its telemetry,
   * so the bench model neither moves it nor speaks for it.
   */
  step(dt: number, nowMs: number, externallyOwned?: (hardwareId: string) => boolean) {
    this.simNowMs = nowMs
    for (const d of this.devices.values()) {
      if (!d.online) continue
      if (externallyOwned?.(d.hardwareId)) continue
      const cmdFresh = d.lastCmd && nowMs - d.cmdReceivedAt < 400
      const cmd = cmdFresh ? d.lastCmd! : null
      const targetV = d.estop ? 0 : cmd ? cmd.v : 0
      const targetW = d.estop ? 0 : cmd ? cmd.omega : 0
      const maxDv = d.maxAccel * dt
      d.velocity += Math.max(-maxDv, Math.min(maxDv, targetV - d.velocity))
      const maxDw = d.maxOmega * dt
      d.omega += Math.max(-maxDw, Math.min(maxDw, targetW - d.omega))
      // wheel slip produces a small, honest odometry error
      d.wheelSlip = 0.02 + Math.sin(nowMs / 1400) * 0.012
      const actualV = d.velocity * (1 - d.wheelSlip)
      d.heading += d.omega * dt
      const step = actualV * dt
      d.distanceM += Math.abs(step)
      d.pose = { x: d.pose.x + Math.cos(d.heading) * step, z: d.pose.z + Math.sin(d.heading) * step }
      d.battery = Math.max(0, d.battery - (d.velocity > 0.02 ? 0.00055 : 0.00008) * dt)
      d.motorCurrentA = 0.4 + d.velocity * 2.6 + (d.velocity > 0 ? 0.4 : 0)
      d.seq++
      if (this.sink) {
        this.sink({
          agentId: '',
          hardwareId: d.hardwareId,
          seq: d.seq,
          emittedAt: nowMs,
          receivedAt: nowMs + this.latencyMs,
          pose: { x: d.pose.x, z: d.pose.z, theta: d.heading },
          velocity: d.velocity,
          omega: d.omega,
          battery: d.battery,
          motorCurrentA: d.motorCurrentA,
          bumperTripped: d.bumper,
          lidarHealthy: true,
          estop: d.estop,
          linkQuality: 1 - this.packetLoss,
          latencyMs: this.latencyMs,
          wheelSlipEstimate: d.wheelSlip,
        })
      }
    }
  }

  /** simulated link fault — the engine re-enables the device on sim time */
  simulateDropout(hardwareId: string) {
    const d = this.devices.get(hardwareId)
    if (d) d.online = false
  }
}

/* --------------------------------------------------------- websocket bridge */

type BridgeListener = (msg: { type: string; [k: string]: unknown }) => void

/**
 * Live connection to the FastAPI robot gateway. Real hardware commands and real
 * telemetry ride this socket and nothing else.
 */
export class WebSocketGateway implements GatewayTransport {
  readonly transport = 'WS_GATEWAY'
  readonly id = 'gw-ws'
  socket: WebSocket | null = null
  connected = false
  latencyMs = 0
  packetLoss = 0
  detail = 'not connected'
  private listeners = new Set<BridgeListener>()
  private outbox: string[] = []
  private clockAccumS = 0

  constructor(private url: string, private onStatus: (s: GatewayStatus) => void) {}

  connect() {
    if (this.socket) return
    try {
      const ws = new WebSocket(this.url)
      this.socket = ws
      ws.onopen = () => {
        this.connected = true
        this.detail = 'connected'
        for (const m of this.outbox) ws.send(m)
        this.outbox = []
        this.emitStatus()
      }
      ws.onclose = () => {
        this.connected = false
        this.detail = 'link closed'
        this.socket = null
        this.emitStatus()
      }
      ws.onerror = () => {
        this.detail = 'socket error'
        this.emitStatus()
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data))
          if (msg.type === 'heartbeat' || msg.type === 'pong') {
            this.latencyMs = Number(msg.latencyMs ?? this.latencyMs)
            this.packetLoss = Number(msg.packetLoss ?? this.packetLoss)
            this.emitStatus()
          }
          this.listeners.forEach((l) => l(msg))
        } catch {
          /* ignore malformed frames */
        }
      }
    } catch {
      this.detail = 'socket unavailable'
    }
  }

  emitStatus() {
    this.onStatus({ connected: this.connected, transport: 'WS_GATEWAY', latencyMs: this.latencyMs, packetLoss: this.packetLoss, detail: this.detail })
  }

  onMessage(l: BridgeListener) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private sendRaw(obj: unknown) {
    const s = JSON.stringify(obj)
    if (this.socket && this.connected) this.socket.send(s)
    else this.outbox.push(s)
  }

  isAvailable(hardwareId: string) {
    // the gateway is the source of truth for what is attached; if the socket is
    // down, no physical command may leave this process
    return this.connected && this.hardwareIds.has(hardwareId)
  }

  hardwareIds = new Set<string>()

  send(agentId: string, hardwareId: string, cmd: MotionCommand) {
    this.sendRaw({ type: 'command', agentId, hardwareId, cmd: { ...cmd, ts: Date.now() } })
  }
  stop(agentId: string, hardwareId: string, reason: string) {
    this.sendRaw({ type: 'stop', agentId, hardwareId, reason })
  }
  estop(agentId: string, hardwareId: string, on: boolean) {
    this.sendRaw({ type: 'estop', agentId, hardwareId, on })
  }
  /**
   * Publish progression of the simulation clock. The device side integrates its
   * bodies in the SAME time base the agents integrate their planned motion in,
   * so the digital twin measures transport/execution divergence rather than a
   * difference between two clocks. Transport latency itself stays in real time.
   */
  sendClock(dt: number) {
    this.clockAccumS += dt
    if (this.clockAccumS < 0.05) return
    const simDt = this.clockAccumS
    this.clockAccumS = 0
    this.sendRaw({ type: 'clock', simDt: Number(simDt.toFixed(5)) })
  }

  /** tell the gateway which agent now owns a body (observability, not authority) */
  bind(agentId: string, hardwareId: string) {
    this.sendRaw({ type: 'bind', agentId, hardwareId })
  }
  unbind(agentId: string, hardwareId: string) {
    this.sendRaw({ type: 'unbind', agentId, hardwareId })
  }
}

/* ------------------------------------------------------------- aggregated */

/** both transports behind one interface so the engine stays ignorant of them */
export class CompositeGateway implements GatewayTransport {
  readonly id = 'gw-composite'
  transport = 'COMPOSITE'
  constructor(public mock: MockDeviceGateway, public bridge: WebSocketGateway | null) {}

  isAvailable(hardwareId: string) {
    if (this.bridge && this.bridge.transport && this.bridge.isAvailable(hardwareId)) return true
    return this.mock.isAvailable(hardwareId)
  }

  /** which transport a given hardware id actually uses right now */
  routeFor(hardwareId: string): { transport: string; isReal: boolean } {
    if (this.bridge && this.bridge.isAvailable(hardwareId)) return { transport: 'WS_GATEWAY', isReal: true }
    if (this.mock.isAvailable(hardwareId)) return { transport: 'MOCK_GATEWAY', isReal: false }
    return { transport: 'NONE', isReal: false }
  }

  /**
   * True when the attached gateway owns this body. A device must have exactly
   * ONE owner: while the bridge is driving a unit, the in-process bench model
   * must not also execute commands or publish telemetry for it, or the twin
   * would be fed two contradictory realities.
   */
  bridgeOwns(hardwareId: string) {
    return !!(this.bridge && this.bridge.isAvailable(hardwareId))
  }

  send(agentId: string, hardwareId: string, cmd: MotionCommand) {
    if (this.bridge && this.bridge.isAvailable(hardwareId)) this.bridge.send(agentId, hardwareId, cmd)
    else if (this.mock.isAvailable(hardwareId)) this.mock.send(agentId, hardwareId, cmd)
  }
  stop(agentId: string, hardwareId: string, reason: string) {
    if (this.bridge && this.bridge.isAvailable(hardwareId)) this.bridge.stop(agentId, hardwareId, reason)
    else if (this.mock.isAvailable(hardwareId)) this.mock.stop(agentId, hardwareId, reason)
  }
  estop(agentId: string, hardwareId: string, on: boolean) {
    if (this.bridge && this.bridge.isAvailable(hardwareId)) this.bridge.estop(agentId, hardwareId, on)
    else if (this.mock.isAvailable(hardwareId)) this.mock.estop(agentId, hardwareId, on)
  }
  /** binding bookkeeping at the gateway — the fleet keeps authority */
  notifyBind(agentId: string, hardwareId: string) {
    if (this.bridge?.connected) this.bridge.bind(agentId, hardwareId)
  }
  notifyUnbind(agentId: string, hardwareId: string) {
    if (this.bridge?.connected) this.bridge.unbind(agentId, hardwareId)
  }
  /** advance the device-side clock by the engine's simulation delta */
  publishClock(dt: number) {
    if (this.bridge?.connected) this.bridge.sendClock(dt)
  }
}

export function hardwareToGatewayProfile(h: PhysicalHardware) {
  return {
    hardwareId: h.id,
    pose: { x: h.position.x, z: h.position.z },
    heading: h.position.theta,
    battery: h.battery,
    maxAccel: h.capabilities.maxAccel,
    maxOmega: h.capabilities.maxOmega,
  }
}
