import type { AgentIntent, Vec2 } from '../../types'

/**
 * Peer-to-peer intent mesh.
 *
 * Robots do not share a brain, but they do share *messages*. This bus models a
 * range-limited radio mesh with per-link latency and loss: a message enqueued by
 * RX-02 at position P is only delivered to agents within MESH_RANGE_M of P, and
 * only after a simulated delay. Nothing here decides anything — decisions stay
 * inside each agent.
 */
export const MESH_RANGE_M = 14

interface Envelope {
  intent: AgentIntent
  origin: Vec2
  deliverAt: number
  delivered: boolean
}

export class IntentMesh {
  private queue: Envelope[] = []
  private logs: AgentIntent[] = []
  traffic = { sent: 0, delivered: 0, dropped: 0 }

  constructor(private latencyMs = 22, private lossRate = 0.0) {}

  setLinkQuality(latencyMs: number, lossRate: number) {
    this.latencyMs = latencyMs
    this.lossRate = lossRate
  }

  /** agents broadcast; delivery is resolved per-receiver by proximity */
  publish(intent: AgentIntent, origin: Vec2, now: number) {
    const jitter = 1 + (Math.abs(hash(intent.from)) % 40) / 100
    this.queue.push({ intent, origin, deliverAt: now + (this.latencyMs / 1000) * jitter, delivered: false })
    this.traffic.sent++
    this.logs.push(intent)
    if (this.logs.length > 400) this.logs.shift()
  }

  /** advance the bus; returns intents that became available this tick */
  step(now: number, positions: Map<string, Vec2>) {
    const ready: { agentId: string; intent: AgentIntent }[] = []
    for (const env of this.queue) {
      if (env.delivered || env.deliverAt > now) continue
      env.delivered = true
      for (const [agentId, pos] of positions) {
        if (agentId === env.intent.from) continue
        const d = Math.hypot(pos.x - env.origin.x, pos.z - env.origin.z)
        if (d > MESH_RANGE_M) continue
        if (this.lossRate > 0 && Math.random() < this.lossRate) {
          this.traffic.dropped++
          continue
        }
        this.traffic.delivered++
        ready.push({ agentId, intent: env.intent })
      }
    }
    // drop envelopes that have been fully handled, keep the queue tight
    if (this.queue.length > 600) this.queue = this.queue.filter((e) => !e.delivered).slice(-200)
    return ready
  }

  recent(limit = 40) {
    return this.logs.slice(-limit)
  }
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h
}
