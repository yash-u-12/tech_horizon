import type { AgentTraits, HardwareCapability, RobotCapabilities, WarehouseObject, WarehouseZone } from '../types'

/* =========================================================================
 *  NEXUS — global configuration.  Everything the simulation needs to be
 *  re-tuned lives here: unit scale, tick rate, warehouse geometry, agent
 *  roster, hardware roster, safety limits.
 * ========================================================================= */

export const TICK_HZ = 20
export const DT = 1 / TICK_HZ
export const WORLD = { width: 60, depth: 36 } // metres
export const GRID_CELL = 1.0
export const GRID_W = Math.round(WORLD.width / GRID_CELL)
export const GRID_D = Math.round(WORLD.depth / GRID_CELL)

/** world (x,z) -> grid (col,row); world origin is centred on the floor */
export const worldToCell = (x: number, z: number) => ({
  c: Math.min(GRID_W - 1, Math.max(0, Math.floor((x + WORLD.width / 2) / GRID_CELL))),
  r: Math.min(GRID_D - 1, Math.max(0, Math.floor((z + WORLD.depth / 2) / GRID_CELL))),
})
export const cellToWorld = (c: number, r: number) => ({
  x: (c + 0.5) * GRID_CELL - WORLD.width / 2,
  z: (r + 0.5) * GRID_CELL - WORLD.depth / 2,
})

/* ------------------------------------------------------------------ robots */

export const DEFAULT_CAPABILITIES: RobotCapabilities = {
  driveType: 'DIFFERENTIAL',
  maxVelocity: 1.0,
  maxAccel: 0.6,
  maxOmega: 1.6,
  maxPayloadKg: 5,
  sensors: ['LIDAR_2D_360', 'ODOMETRY', 'IMU', 'ULTRASONIC'],
  navigation: true,
  telemetry: true,
  collisionRadius: 0.42,
}

export const HEAVY_CAPABILITIES: RobotCapabilities = {
  ...DEFAULT_CAPABILITIES,
  maxVelocity: 0.8,
  maxPayloadKg: 12,
  sensors: ['LIDAR_2D_360', 'ODOMETRY', 'IMU', 'ULTRASONIC', 'DEPTH_CAMERA'],
}

export interface AgentSeed {
  id: string
  label: string
  capabilities: RobotCapabilities
  traits: AgentTraits
  homeZone: string
  battery: number
  /** this agent can be projected onto physical hardware of matching class */
  realCapable: boolean
  bodyClass: 'AMR-LIGHT' | 'AMR-HEAVY'
}

export const AGENT_ROSTER: AgentSeed[] = [
  {
    id: 'RX-02',
    label: 'RX-02',
    capabilities: DEFAULT_CAPABILITIES,
    homeZone: 'INBOUND',
    battery: 0.86,
    realCapable: true,
    bodyClass: 'AMR-LIGHT',
    traits: { caution: 0.55, patience: 0.6, rerouteTolerance: 0.5, chargeThreshold: 0.22, speedBias: 0.92, lookaheadS: 3.0, profile: 'BALANCED' },
  },
  {
    id: 'RX-03',
    label: 'RX-03',
    capabilities: DEFAULT_CAPABILITIES,
    homeZone: 'PACKING',
    battery: 0.72,
    realCapable: true,
    bodyClass: 'AMR-LIGHT',
    traits: { caution: 0.35, patience: 0.3, rerouteTolerance: 0.75, chargeThreshold: 0.18, speedBias: 1.0, lookaheadS: 2.4, profile: 'AGGRESSIVE' },
  },
  {
    id: 'RX-04',
    label: 'RX-04',
    capabilities: DEFAULT_CAPABILITIES,
    homeZone: 'STORAGE',
    battery: 0.63,
    realCapable: true,
    bodyClass: 'AMR-LIGHT',
    traits: { caution: 0.8, patience: 0.85, rerouteTolerance: 0.2, chargeThreshold: 0.3, speedBias: 0.82, lookaheadS: 4.0, profile: 'CONSERVATIVE' },
  },
  {
    id: 'RX-05',
    label: 'RX-05',
    capabilities: HEAVY_CAPABILITIES,
    homeZone: 'SORTING',
    battery: 0.94,
    realCapable: true,
    bodyClass: 'AMR-HEAVY',
    traits: { caution: 0.5, patience: 0.5, rerouteTolerance: 0.55, chargeThreshold: 0.25, speedBias: 0.85, lookaheadS: 3.2, profile: 'HEAVY-HAUL' },
  },
  {
    id: 'RX-06',
    label: 'RX-06',
    capabilities: DEFAULT_CAPABILITIES,
    homeZone: 'OUTBOUND',
    battery: 0.41,
    realCapable: true,
    bodyClass: 'AMR-LIGHT',
    traits: { caution: 0.65, patience: 0.55, rerouteTolerance: 0.4, chargeThreshold: 0.35, speedBias: 0.88, lookaheadS: 3.6, profile: 'EFFICIENT' },
  },
]

/* ----------------------------------------------------------------- hardware */

export interface HardwareSeed {
  id: string
  label: string
  status: 'OFFLINE' | 'ONLINE' | 'BUSY' | 'ERROR'
  transport: 'MOCK_GATEWAY' | 'ROS2_BRIDGE' | 'SERIAL_GATEWAY' | 'WS_GATEWAY'
  isRealHardware: boolean
  battery: number
  capabilities: HardwareCapability
  firmware: string
  pose: { x: number; z: number; theta: number }
}

export const HARDWARE_ROSTER: HardwareSeed[] = [
  {
    id: 'P01',
    label: 'P01 · AMR-LIGHT',
    status: 'ONLINE',
    transport: 'MOCK_GATEWAY',
    isRealHardware: false,
    battery: 0.91,
    firmware: 'nexus-mcu 2.4.1',
    pose: { x: -24, z: 14, theta: 0 },
    capabilities: {
      driveType: 'DIFFERENTIAL',
      maxVelocity: 1.2,
      maxAccel: 0.8,
      maxOmega: 1.9,
      payloadKg: 10,
      sensors: ['LIDAR_2D_360', 'ODOMETRY', 'IMU'],
      navigation: true,
      telemetry: true,
    },
  },
  {
    id: 'P02',
    label: 'P02 · AMR-HEAVY',
    status: 'OFFLINE',
    transport: 'MOCK_GATEWAY',
    // nothing is advertised as real hardware until a robot gateway reports an
    // actual device session for it
    isRealHardware: false,
    battery: 0.64,
    firmware: 'ros2-jazzy / nav2',
    pose: { x: 24, z: -14, theta: Math.PI },
    capabilities: {
      driveType: 'DIFFERENTIAL',
      maxVelocity: 0.7,
      maxAccel: 0.45,
      maxOmega: 1.2,
      payloadKg: 40,
      sensors: ['LIDAR_2D_360', 'ODOMETRY', 'IMU', 'DEPTH_CAMERA'],
      navigation: true,
      telemetry: true,
    },
  },
  {
    id: 'P03',
    label: 'P03 · AMR-LEGACY',
    status: 'ONLINE',
    transport: 'MOCK_GATEWAY',
    isRealHardware: false,
    battery: 0.55,
    firmware: 'esp32-fw 1.1.0',
    pose: { x: 0, z: -16.5, theta: 0 },
    capabilities: {
      driveType: 'ACKERMANN',
      maxVelocity: 0.5,
      maxAccel: 0.3,
      maxOmega: 0.6,
      payloadKg: 3,
      sensors: ['ULTRASONIC', 'ODOMETRY'],
      navigation: false,
      telemetry: false,
    },
  },
]

/* ---------------------------------------------------------------- warehouse */

export const ZONES: WarehouseZone[] = [
  { id: 'INBOUND', kind: 'INBOUND', label: 'INBOUND', rect: { x: -28.5, z: 12.5, w: 9, d: 9 }, color: '#2b6cb0' },
  { id: 'OUTBOUND', kind: 'OUTBOUND', label: 'OUTBOUND', rect: { x: 19.5, z: 12.5, w: 9, d: 9 }, color: '#2f855a' },
  { id: 'SORTING', kind: 'SORTING', label: 'SORTING', rect: { x: 19.5, z: -12.5, w: 9, d: 9 }, color: '#6b46c1' },
  { id: 'PACKING', kind: 'PACKING', label: 'PACKING', rect: { x: -28.5, z: -12.5, w: 9, d: 9 }, color: '#b7791f' },
  { id: 'CHARGING', kind: 'CHARGING', label: 'CHARGING BAY', rect: { x: -29, z: 0, w: 5, d: 8 }, color: '#2c7a7b' },
]

/** Scenario blockable aisle ids (used by the blocked-aisle scenario) */
export const AISLE_IDS = ['AISLE-A', 'AISLE-B', 'AISLE-C']

/**
 * Storage geometry is chosen so that every aisle is genuinely traversable in
 * configuration space: rack footprint + robot inflation < row/column pitch.
 * (aisle clear width ≈ 3.0 m in z, ≈ 2.2 m in x — verified by the planner.)
 */
export const RACK_ROWS: { z: number; label: string }[] = [
  { z: -9, label: 'A' },
  { z: -3, label: 'B' },
  { z: 3, label: 'C' },
  { z: 9, label: 'D' },
]
export const RACK_COLS = [-20, -14, -8, -2, 4, 10]
export const RACK_SIZE = { w: 2.8, d: 2.0 }
export const RACK_HEIGHT = 2.6

export function buildWarehouseObjects(): WarehouseObject[] {
  const objects: WarehouseObject[] = []
  // storage rack cluster
  RACK_ROWS.forEach((row, ri) => {
    RACK_COLS.forEach((x, ci) => {
      // deliberate service gaps keep a cross-aisle open end-to-end
      if (ri === 1 && ci === 3) return
      if (ri === 2 && ci === 1) return
      const id = `RACK-${row.label}${String(ci + 1).padStart(2, '0')}`
      objects.push({
        id,
        kind: 'RACK',
        label: id,
        rect: { x, z: row.z, w: RACK_SIZE.w, d: RACK_SIZE.d },
        height: RACK_HEIGHT,
        packages: [],
        reservedBy: null,
        // pick face on the lower z side, in the aisle
        pickFace: { x, z: row.z - 2.4 },
      })
    })
  })
  // charging stations (against the west wall, clear approach corridor)
  for (let i = 0; i < 2; i++) {
    objects.push({
      id: `CHARGE-${i + 1}`,
      kind: 'CHARGE_STATION',
      label: `CHARGE-${i + 1}`,
      rect: { x: -29.2, z: -2.4 + i * 4.8, w: 1.4, d: 2.4 },
      height: 1.2,
      packages: [],
      reservedBy: null,
      pickFace: { x: -26.2, z: -2.4 + i * 4.8 },
    })
  }
  // station objects for the four dock zones
  const stationDef = [
    { id: 'INBOUND-S1', x: -27.5, z: 13.5 },
    { id: 'INBOUND-S2', x: -27.5, z: 16.5 },
    { id: 'OUTBOUND-S1', x: 20.5, z: 13.5 },
    { id: 'OUTBOUND-S2', x: 20.5, z: 16.5 },
    { id: 'SORTING-S1', x: 20.5, z: -13.5 },
    { id: 'SORTING-S2', x: 20.5, z: -10.5 },
    { id: 'PACKING-S1', x: -27.5, z: -13.5 },
    { id: 'PACKING-S2', x: -27.5, z: -10.5 },
  ]
  stationDef.forEach((s) =>
    objects.push({
      id: s.id,
      kind: 'STATION',
      label: s.id,
      rect: { x: s.x, z: s.z, w: 1.8, d: 1.8 },
      height: 0.9,
      packages: [],
      reservedBy: null,
      pickFace: { x: s.x + 2.6, z: s.z },
    }),
  )
  // a conveyor spine along the east wall of the sorting hall
  objects.push({
    id: 'CONVEYOR-01',
    kind: 'CONVEYOR',
    label: 'SORT CONVEYOR',
    rect: { x: 26.6, z: -12.5, w: 1.4, d: 7 },
    height: 0.8,
    packages: [],
    reservedBy: null,
  })
  return objects
}

/** Fixed non-rack obstacles that make the space non-trivial. */
export const STATIC_OBSTACLES = [
  { id: 'COL-01', rect: { x: 14.5, z: 5.5, w: 1.2, d: 1.2 }, label: 'COLUMN 01' },
  { id: 'COL-02', rect: { x: -24.5, z: 5.5, w: 1.2, d: 1.2 }, label: 'COLUMN 02' },
  { id: 'COL-03', rect: { x: 0, z: 13.8, w: 1.2, d: 1.2 }, label: 'COLUMN 03' },
  { id: 'COL-04', rect: { x: 14.5, z: -5.5, w: 1.2, d: 1.2 }, label: 'COLUMN 04' },
  { id: 'COL-05', rect: { x: -24.5, z: -5.5, w: 1.2, d: 1.2 }, label: 'COLUMN 05' },
]

export const SAFETY = {
  maxLinearVelocity: 1.4, // hard ceiling regardless of agent wish
  maxAngularVelocity: 2.2,
  minObstacleClearance: 0.35,
  hardStopClearance: 0.22,
  commandStaleMs: 400,
  maxLatencyMs: 350,
  minBatteryToDeploy: 0.25,
  estopAlwaysWins: true,
}

export const CHARGE_RATE = 0.030 // battery fraction per sim second while charging
export const DISCHARGE_IDLE = 0.00035
export const DISCHARGE_MOVE = 0.00105 // per sim second at full speed (~16 min of driving per charge)
// One package handling cycle (pickup plus drop) is capped at three seconds.
export const PICK_DURATION_S = 1.5
export const DROP_DURATION_S = 1.5
export const DOCK_RADIUS_M = 1.25
export const TASK_ARRIVAL_INTERVAL_S = 11
export const MAX_ACTIVE_TASKS = 6

export const LANE_YIELD_RADIUS = 2.4
export const TTC_HORIZON_S = 5.0
