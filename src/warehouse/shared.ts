/**
 * Shared helpers for the 3D warehouse.
 *
 * World space is 2D: x ∈ [0, WORLD_W], y ∈ [0, WORLD_H], heading CCW from +X.
 * Three.js space puts the ground on the XZ plane with +Y up, centred on origin.
 */

import * as THREE from 'three';
import { WORLD_H, WORLD_W } from '@/simulation/environment/warehouse';
import type { PathStatus } from '@/simulation/types';

export const HALF_W = WORLD_W / 2;
export const HALF_H = WORLD_H / 2;

/** world (x,y) → three (x, z) */
export const tx = (wx: number) => wx - HALF_W;
export const tz = (wy: number) => wy - HALF_H;

/** world heading (CCW from +X) → three rotation about +Y */
export const tRot = (theta: number) => -theta;

export const w2t = (x: number, y: number): [number, number] => [tx(x), tz(y)];

export const PATH_COLORS: Record<PathStatus, string> = {
  PLANNED: '#38BDF8',
  ACTIVE: '#38BDF8',
  COMPLETED: '#34D399',
  BLOCKED: '#F87171',
  REPLANNED: '#A78BFA',
  ABORTED: '#64748B',
};

export const STATUS_COLORS: Record<string, string> = {
  IDLE: '#64748B',
  MOVING: '#38BDF8',
  WAITING: '#FBBF24',
  PICKING: '#22D3EE',
  DROPPING: '#22D3EE',
  CHARGING: '#34D399',
  REROUTING: '#A78BFA',
  BLOCKED: '#F87171',
  DEGRADED: '#FB923C',
  OFFLINE: '#EF4444',
  ESTOP: '#EF4444',
  BINDING: '#A78BFA',
};

export function statusColor(s: string) {
  return STATUS_COLORS[s] ?? '#64748B';
}

/** Deterministic per-robot accent, used for the chassis trim. */
export function hexToThree(hex: string) {
  return new THREE.Color(hex);
}

export const FLOOR_Y = 0;
