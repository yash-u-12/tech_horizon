/**
 * SAFETY LAYER
 *
 * Every command bound for a physical body passes through here. It is the last
 * gate before metal moves and it can reject or clamp anything:
 *
 *   - unsafe speed / acceleration / turn rate
 *   - commands that would drive into a known obstacle
 *   - commands that would enter a restricted area or leave the geofence
 *   - impossible movements (NaN, teleports, contradictory kinematics)
 *
 * Emergency stop always wins. Nothing in the simulation can bypass this: the
 * agent does not even have a reference to the raw interface.
 */

import type { RobotCapabilities, RobotCommand, RobotActionType } from '../types';
import type { Vec2 } from '../types';
import { clamp } from '../core/math';

export interface SafetyContext {
  pose: { x: number; y: number; theta: number };
  currentSpeed: number;
  capabilities: RobotCapabilities;
  /** static + dynamic obstacles near the robot */
  obstacles: { x: number; y: number; r: number }[];
  peers: { id: string; x: number; y: number; vx: number; vy: number }[];
  restricted: { x0: number; y0: number; x1: number; y1: number }[];
  bounds: { w: number; h: number };
  estop: boolean;
  /** operator-imposed speed cap (0..1) */
  speedCap: number;
  dt: number;
}

export interface SafetyVerdict {
  allowed: boolean;
  v: number;
  w: number;
  clamped: boolean;
  reason?: string;
  hardStop: boolean;
}

const STOP_DISTANCE_FACTOR = 1.35;

export function validateCommand(cmd: RobotCommand, ctx: SafetyContext): SafetyVerdict {
  // ── hard overrides ────────────────────────────────────────────────────────
  if (ctx.estop) {
    return { allowed: true, v: 0, w: 0, clamped: true, reason: 'E-STOP ACTIVE', hardStop: true };
  }
  if (cmd.action === 'ESTOP') {
    return { allowed: true, v: 0, w: 0, clamped: false, hardStop: true };
  }

  // ── sanity ────────────────────────────────────────────────────────────────
  if (!Number.isFinite(cmd.v) || !Number.isFinite(cmd.w)) {
    return { allowed: false, v: 0, w: 0, clamped: true, reason: 'NON-FINITE COMMAND', hardStop: true };
  }

  let v = cmd.v;
  let w = cmd.w;
  let clamped = false;
  let reason: string | undefined;

  // ── kinematic envelope ────────────────────────────────────────────────────
  const vMax = Math.min(ctx.capabilities.maxVelocity * ctx.speedCap, ctx.currentSpeed + ctx.capabilities.maxAccel * ctx.dt);
  if (v > vMax + 1e-6) {
    v = vMax;
    clamped = true;
    if (!reason) reason = 'ACCELERATION LIMIT';
  }
  if (v < -0.35) {
    v = -0.35;
    clamped = true;
    if (!reason) reason = 'REVERSE LIMIT';
  }
  if (Math.abs(w) > ctx.capabilities.maxOmega) {
    w = Math.sign(w) * ctx.capabilities.maxOmega;
    clamped = true;
    if (!reason) reason = 'TURN RATE LIMIT';
  }
  // curvature limit for non-holonomic drives
  if (ctx.capabilities.drive === 'ACKERMANN' && Math.abs(v) > 0.05) {
    const maxW = Math.abs(v) / ctx.capabilities.turningRadius;
    if (Math.abs(w) > maxW) {
      w = Math.sign(w) * maxW;
      clamped = true;
      if (!reason) reason = 'TURNING RADIUS';
    }
  }

  // ── geofence ──────────────────────────────────────────────────────────────
  const m = ctx.capabilities.footprint * 0.6;
  const projected = project(ctx.pose, v, w, ctx.dt * 4);
  if (projected.x < m || projected.y < m || projected.x > ctx.bounds.w - m || projected.y > ctx.bounds.h - m) {
    return { allowed: false, v: 0, w, clamped: true, reason: 'GEOFENCE', hardStop: true };
  }
  for (const z of ctx.restricted) {
    if (projected.x > z.x0 && projected.x < z.x1 && projected.y > z.y0 && projected.y < z.y1) {
      return { allowed: false, v: 0, w, clamped: true, reason: 'RESTRICTED ZONE', hardStop: true };
    }
  }

  // ── stopping distance against known obstacles ─────────────────────────────
  const stopDist = (v * v) / (2 * Math.max(0.2, ctx.capabilities.maxAccel)) + ctx.capabilities.footprint * STOP_DISTANCE_FACTOR;
  let nearest = Infinity;
  let blockedAhead = false;
  const fx = Math.cos(ctx.pose.theta);
  const fy = Math.sin(ctx.pose.theta);
  for (const o of ctx.obstacles) {
    const dx = o.x - ctx.pose.x;
    const dy = o.y - ctx.pose.y;
    const d = Math.hypot(dx, dy) - o.r;
    if (d < nearest) nearest = d;
    if (dx * fx + dy * fy > 0 && d < stopDist) blockedAhead = true;
  }
  for (const p of ctx.peers) {
    const dx = p.x - ctx.pose.x;
    const dy = p.y - ctx.pose.y;
    const d = Math.hypot(dx, dy) - ctx.capabilities.footprint;
    if (d < nearest) nearest = d;
    if (dx * fx + dy * fy > 0 && d < stopDist) blockedAhead = true;
  }

  if (nearest < ctx.capabilities.footprint * 0.95) {
    return { allowed: false, v: 0, w: 0, clamped: true, reason: 'PROXIMITY HARD STOP', hardStop: true };
  }
  if (blockedAhead && v > 0.12) {
    v = 0.12;
    clamped = true;
    if (!reason) reason = 'STOPPING DISTANCE';
  }

  return { allowed: true, v, w, clamped, reason, hardStop: false };
}

function project(pose: { x: number; y: number; theta: number }, v: number, w: number, dt: number): Vec2 {
  const theta = pose.theta + w * dt;
  return { x: pose.x + Math.cos(theta) * v * dt, y: pose.y + Math.sin(theta) * v * dt };
}

export function describeAction(action: RobotActionType): string {
  return action.replace(/_/g, ' ');
}
