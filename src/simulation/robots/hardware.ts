/**
 * HARDWARE REGISTRY + CAPABILITY MATCHING
 *
 * §47A: binding is decided by `compatible(agent, hardware)` — never by
 * `robotId === 'R01'`. Any agent whose capability profile is satisfied by a
 * free hardware unit can be deployed onto it, and the same unit can be rebound
 * to a different agent after a safe release.
 */

import type { CompatibilityCheck, CompatibilityReport, PhysicalUnit, RobotCapabilities } from '../types';
import { MockPhysicalRobotInterface, PhysicalRobotInterface, type RobotInterface } from './interfaces';
import { entityRng } from '../core/rng';

export const DEFAULT_AGENT_CAPS: RobotCapabilities = {
  drive: 'DIFFERENTIAL',
  maxVelocity: 1.0,
  maxAccel: 0.9,
  maxOmega: 2.2,
  payloadKg: 5,
  lidar: true,
  navigation: true,
  requiredTelemetry: ['pose', 'velocity', 'battery', 'scan'],
  turningRadius: 0,
  footprint: 0.72,
  sensorRange: 6.5,
};

export const LITE_AGENT_CAPS: RobotCapabilities = {
  ...DEFAULT_AGENT_CAPS,
  lidar: false,
  maxVelocity: 0.8,
  payloadKg: 3,
  sensorRange: 4.0,
};

export class HardwareRegistry {
  units: PhysicalUnit[] = [];
  interfaces = new Map<string, RobotInterface>();

  /** Seed the registry with mock units. Real units replace them 1:1. */
  createMockFleet(seed: number, count = 3, startPose: { x: number; y: number }[] = []) {
    const poses = startPose.length
      ? startPose
      : [
          { x: 3.0, y: 16.0 },
          { x: 3.0, y: 13.0 },
          { x: 41.0, y: 16.0 },
        ];
    this.units = [];
    this.interfaces.clear();
    for (let i = 0; i < count; i++) {
      const id = `P${String(i + 1).padStart(2, '0')}`;
      const available = i === 0;
      const unit: PhysicalUnit = {
        id,
        name: `AMR-UNIT ${id}`,
        model: i === 0 ? 'NEXUS-AMR-200 (mock)' : 'NEXUS-AMR-120 (mock)',
        mock: true,
        status: available ? 'ONLINE' : i === 1 ? 'BUSY' : 'OFFLINE',
        battery: [91, 76, 12][i] ?? 80,
        pose: { x: poses[i % poses.length].x, y: poses[i % poses.length].y, theta: 0 },
        capabilities:
          i === 0
            ? { ...DEFAULT_AGENT_CAPS, maxVelocity: 1.2, payloadKg: 10, sensorRange: 8.0 }
            : i === 1
              ? { ...DEFAULT_AGENT_CAPS, maxVelocity: 1.0, payloadKg: 5 }
              : { ...LITE_AGENT_CAPS, maxVelocity: 0.7, payloadKg: 3, lidar: false },
        boundTo: null,
        firmware: 'nx-fw-2.4.1-mock',
        transport: 'MOCK_BRIDGE',
        endpoint: 'mock://localhost/bridge',
      };
      this.units.push(unit);
      const iface = new MockPhysicalRobotInterface({
        id,
        model: unit.model,
        start: unit.pose,
        capabilities: unit.capabilities,
        battery: unit.battery,
        rng: entityRng(seed, id),
        latency: 0.08,
        loss: 0.01,
      });
      if (unit.status === 'ONLINE') iface.connect();
      this.interfaces.set(id, iface);
    }
  }

  /** Bring a real unit online, replacing the mock with a ROS 2 transport. */
  attachPhysical(id: string, endpoint: string, namespace: string) {
    const unit = this.units.find((u) => u.id === id);
    if (!unit) return;
    unit.mock = false;
    unit.transport = 'ROS2_WEBSOCKET';
    unit.endpoint = endpoint;
    unit.firmware = unit.firmware.replace('-mock', '');
    const iface = new PhysicalRobotInterface(id, {
      endpoint,
      namespace,
      telemetryTopic: `${namespace}/telemetry`,
      commandTopic: `${namespace}/cmd_vel`,
    });
    iface.connect();
    this.interfaces.set(id, iface);
  }

  get(id: string) {
    return this.units.find((u) => u.id === id);
  }

  iface(id: string) {
    return this.interfaces.get(id);
  }

  bind(hardwareId: string, robotId: string) {
    const u = this.get(hardwareId);
    if (u) {
      u.boundTo = robotId;
      u.status = 'BUSY';
    }
  }

  release(hardwareId: string) {
    const u = this.get(hardwareId);
    if (u) {
      u.boundTo = null;
      u.status = u.status === 'OFFLINE' ? 'OFFLINE' : 'ONLINE';
    }
  }

  tickAll(now: number, dt: number) {
    for (const [, iface] of this.interfaces) iface.tick(now, dt);
    for (const u of this.units) {
      const i = this.interfaces.get(u.id);
      if (i instanceof MockPhysicalRobotInterface) {
        u.pose = i.truePose;
        u.battery = i.energy;
        if (u.status !== 'OFFLINE') u.status = i.status === 'ESTOP' ? 'ESTOP' : u.boundTo ? 'BUSY' : 'ONLINE';
      }
    }
  }
}

/**
 * Capability matching. Compares what the AGENT needs against what the
 * HARDWARE can actually do. Fails closed.
 */
export function checkCompatibility(
  robotId: string,
  need: RobotCapabilities,
  unit: PhysicalUnit,
): CompatibilityReport {
  const have = unit.capabilities;
  const checks: CompatibilityCheck[] = [];

  const add = (key: string, label: string, pass: boolean, required: string, available: string) =>
    checks.push({ key, label, pass, required, available });

  add('drive', 'Drive type', have.drive === need.drive, need.drive, have.drive);
  add('nav', 'Onboard navigation', have.navigation || !need.navigation, need.navigation ? 'REQUIRED' : 'NOT REQUIRED', have.navigation ? 'SUPPORTED' : 'NOT SUPPORTED');
  add('lidar', 'LiDAR / perception', have.lidar || !need.lidar, need.lidar ? 'REQUIRED' : 'OPTIONAL', have.lidar ? 'AVAILABLE' : 'NOT AVAILABLE');
  add('velocity', 'Max velocity', have.maxVelocity >= need.maxVelocity * 0.9, `0–${need.maxVelocity.toFixed(1)} m/s`, `0–${have.maxVelocity.toFixed(1)} m/s`);
  add('accel', 'Acceleration', have.maxAccel >= need.maxAccel * 0.75, `${need.maxAccel.toFixed(2)} m/s²`, `${have.maxAccel.toFixed(2)} m/s²`);
  add('omega', 'Turn rate', have.maxOmega >= need.maxOmega * 0.8, `${need.maxOmega.toFixed(2)} rad/s`, `${have.maxOmega.toFixed(2)} rad/s`);
  add('payload', 'Payload capacity', have.payloadKg >= need.payloadKg, `${need.payloadKg} kg`, `${have.payloadKg} kg`);
  add('telemetry', 'Telemetry streams', need.requiredTelemetry.every((t) => t !== 'scan' || have.lidar), need.requiredTelemetry.join(', '), have.lidar ? 'pose, velocity, battery, scan' : 'pose, velocity, battery');
  add('status', 'Unit availability', unit.status === 'ONLINE' && !unit.boundTo, 'ONLINE + FREE', unit.boundTo ? `BOUND TO ${unit.boundTo}` : unit.status);

  const failed = checks.filter((c) => !c.pass);
  const compatible = failed.length === 0;
  return {
    robotId,
    hardwareId: unit.id,
    compatible,
    checks,
    score: checks.filter((c) => c.pass).length / checks.length,
    reason: compatible ? undefined : failed.map((f) => f.label).join(', '),
    at: 0,
  };
}
