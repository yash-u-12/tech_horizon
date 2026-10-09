/**
 * COMMUNICATION BUS
 *
 * A deliberately imperfect channel: every message has latency, a per-robot
 * packet-loss probability, and per-robot ordering. Agents are never given a
 * synchronised global view — they only ever see what actually arrived.
 *
 * This is what makes the coordination genuinely decentralised: an agent cannot
 * assume it knows what its peers know.
 */

import type { TaskBid, TaskPriority, Vec2 } from '../types';
import type { Rng } from '../core/rng';

export type Message =
  | { kind: 'TASK_ANNOUNCE'; from: string; taskId: string; t: number; priority: TaskPriority; from_: Vec2; to_: Vec2; requiresLidar: boolean; weightKg: number; sla: number }
  | { kind: 'TASK_BID'; from: string; taskId: string; t: number; bid: TaskBid }
  | { kind: 'TASK_CLAIM'; from: string; taskId: string; t: number; cost: number }
  | { kind: 'TASK_RELEASE'; from: string; taskId: string; t: number; reason: string }
  | { kind: 'TASK_DONE'; from: string; taskId: string; t: number }
  | { kind: 'INTENT'; from: string; t: number; waypoints: { x: number; y: number; t: number }[]; priority: number; speed: number }
  | { kind: 'HAZARD'; from: string; t: number; id: string; x: number; y: number; r: number }
  | { kind: 'STATUS'; from: string; t: number; status: string; battery: number; pose: Vec2; theta: number }
  | { kind: 'ESTOP'; from: string; t: number; robotId: string };

interface Pending {
  msg: Message;
  deliverAt: number;
  /** per-recipient drop decisions are made at delivery time */
}

export interface LinkQuality {
  latency: number; // sim seconds, one way
  loss: number; // 0..1
  connected: boolean;
}

export class CommsBus {
  private pending: Pending[] = [];
  private inboxes = new Map<string, Message[]>();
  private rng: Rng;
  private links = new Map<string, LinkQuality>();

  stats = { sent: 0, delivered: 0, dropped: 0 };

  constructor(rng: Rng) {
    this.rng = rng;
  }

  setLink(id: string, q: LinkQuality) {
    this.links.set(id, q);
  }

  getLink(id: string): LinkQuality {
    return this.links.get(id) ?? { latency: 0.05, loss: 0, connected: true };
  }

  register(id: string) {
    if (!this.inboxes.has(id)) this.inboxes.set(id, []);
  }

  broadcast(msg: Message, now: number) {
    this.stats.sent++;
    this.pending.push({ msg, deliverAt: now });
  }

  /**
   * Advance the channel; fills per-robot inboxes. Latency is applied PER
   * RECIPIENT, so two robots can receive the same message at different times —
   * and one of them can lose it entirely.
   */
  flush(now: number) {
    if (!this.pending.length) return;
    const rest: Pending[] = [];
    for (const p of this.pending) {
      let complete = true;
      for (const [id, box] of this.inboxes) {
        const link = this.getLink(id);
        const isSender = id === p.msg.from;
        const jitter = isSender ? 0 : link.latency * (0.75 + 0.5 * this.rng());
        if (now < p.deliverAt + jitter) {
          complete = false;
          continue;
        }
        if (!isSender) {
          if (!link.connected || this.rng() < link.loss) {
            this.stats.dropped++;
            continue;
          }
        }
        box.push(p.msg);
        this.stats.delivered++;
      }
      if (!complete) rest.push(p);
    }
    this.pending = rest;
  }

  /** Deliver with per-link latency applied at send time (used for unicast-ish paths). */
  send(msg: Message, now: number, latency?: number) {
    this.stats.sent++;
    this.pending.push({ msg, deliverAt: now + (latency ?? 0) });
  }

  inbox(id: string): Message[] {
    return this.inboxes.get(id) ?? [];
  }

  clearInbox(id: string) {
    const b = this.inboxes.get(id);
    if (b) b.length = 0;
  }

  reset() {
    this.pending.length = 0;
    for (const b of this.inboxes.values()) b.length = 0;
    this.stats = { sent: 0, delivered: 0, dropped: 0 };
  }
}
