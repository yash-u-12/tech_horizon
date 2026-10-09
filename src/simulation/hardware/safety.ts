import { SAFETY } from '../config'
import type { MotionCommand, PhysicalHardware, SafetyResult, SafetyState, Vec2 } from '../../types'

/**
 * SAFETY LAYER (simulation side).
 *
 * Every command bound for a physical body passes through this validator before
 * it leaves the process, and again through the authoritative validator inside
 * the NEXUS gateway. Physical safety always overrides virtual intelligence:
 * an agent may *want* 1.0 m/s, the envelope decides what is legal.
 */
export interface SafetyInput {
  /** simulation clock in ms — freshness is measured on sim time, not wall time */
  nowMs: number
  cmd: MotionCommand
  hardware: PhysicalHardware
  /** distance to nearest obstruction reported by the agent's perception */
  obstacleClearance: number
  /** distance to nearest other robot */
  peerClearance: number
  /** ms since the agent last received telemetry from this body */
  telemetryAgeMs: number
  hardwareOnline: boolean
  workspaceOk: boolean
  /** the agent's own commanded time-to-collision with a peer, if any */
  ttc: number | null
  eStopExternal: boolean
}

export function validateCommand(input: SafetyInput): SafetyResult {
  const checks: SafetyResult['checks'] = []
  const violations: string[] = []
  const { cmd, hardware } = input

  const push = (rule: string, value: string, limit: string, pass: boolean) => {
    checks.push({ rule, value, limit, pass })
    if (!pass) violations.push(`${rule}: ${value} (limit ${limit})`)
  }

  push('LINEAR VELOCITY', `${Math.abs(cmd.v).toFixed(2)} m/s`, `≤ ${SAFETY.maxLinearVelocity.toFixed(2)} m/s`, Math.abs(cmd.v) <= SAFETY.maxLinearVelocity)
  push(
    'BODY VELOCITY LIMIT',
    `${Math.abs(cmd.v).toFixed(2)} m/s`,
    `≤ ${hardware.capabilities.maxVelocity.toFixed(2)} m/s`,
    Math.abs(cmd.v) <= hardware.capabilities.maxVelocity + 1e-6,
  )
  push('ANGULAR VELOCITY', `${cmd.omega.toFixed(2)} rad/s`, `≤ ${SAFETY.maxAngularVelocity.toFixed(2)}`, Math.abs(cmd.omega) <= SAFETY.maxAngularVelocity)
  push(
    'BODY TURN LIMIT',
    `${Math.abs(cmd.omega).toFixed(2)} rad/s`,
    `≤ ${hardware.capabilities.maxOmega.toFixed(2)}`,
    Math.abs(cmd.omega) <= hardware.capabilities.maxOmega + 1e-6,
  )
  push(
    'OBSTACLE CLEARANCE',
    `${input.obstacleClearance.toFixed(2)} m`,
    `≥ ${SAFETY.minObstacleClearance.toFixed(2)} m`,
    input.obstacleClearance > SAFETY.minObstacleClearance || cmd.v < 0.05,
  )
  push(
    'COMMAND FRESHNESS',
    `${Math.max(0, input.nowMs - cmd.ts).toFixed(0)} ms`,
    `≤ ${SAFETY.commandStaleMs} ms`,
    input.nowMs - cmd.ts <= SAFETY.commandStaleMs,
  )
  push('TELEMETRY HEALTH', `${input.telemetryAgeMs.toFixed(0)} ms`, `≤ ${SAFETY.maxLatencyMs} ms`, input.telemetryAgeMs <= SAFETY.maxLatencyMs)
  push('HARDWARE LINK', input.hardwareOnline ? 'ONLINE' : 'OFFLINE', 'ONLINE', input.hardwareOnline)
  push('WORKSPACE BOUNDS', input.workspaceOk ? 'INSIDE' : 'OUTSIDE', 'INSIDE', input.workspaceOk)
  push(
    'COLLISION RISK (TTC)',
    input.ttc === null ? 'n/a' : `${input.ttc.toFixed(2)} s`,
    '≥ 1.20 s or v < 0.05',
    input.ttc === null || input.ttc >= 1.2 || cmd.v < 0.05,
  )
  push('EMERGENCY STOP', input.eStopExternal ? 'ASSERTED' : 'CLEAR', 'CLEAR', !input.eStopExternal)

  return { pass: violations.length === 0, checks, violations }
}

/** velocity envelope applied to an agent's wish before it becomes a command */
export function applyEnvelope(cmd: MotionCommand, hardware: PhysicalHardware, clearance: number): MotionCommand {
  const vCeil = Math.min(SAFETY.maxLinearVelocity, hardware.capabilities.maxVelocity)
  const aCeil = Math.min(hardware.capabilities.maxAccel, 0.8)
  const vClear = Math.sqrt(Math.max(0, 2 * aCeil * Math.max(0, clearance - SAFETY.minObstacleClearance)))
  const magnitude = Math.min(Math.abs(cmd.v), vCeil, Math.max(vClear, 0))
  return {
    ...cmd,
    v: cmd.v < 0 ? -magnitude * 0.5 : magnitude,
    omega: Math.max(-SAFETY.maxAngularVelocity, Math.min(SAFETY.maxAngularVelocity, cmd.omega)),
  }
}

export function workspaceContains(p: Vec2, halfW: number, halfD: number) {
  return Math.abs(p.x) <= halfW && Math.abs(p.z) <= halfD
}

export function initialSafetyState(): SafetyState {
  return { armed: false, eStop: false, lastValidationAt: 0, violations: 0, rejectedCommands: 0, velocityCeiling: SAFETY.maxLinearVelocity }
}
