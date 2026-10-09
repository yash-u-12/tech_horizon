/**
 * NEXUS — Core data models
 * ----------------------------------------------------------------------------
 * The single most important architectural boundary in this file is the split
 * between GLOBAL ENVIRONMENT STATE and INDIVIDUAL ROBOT CONTEXT.
 *
 *   WarehouseState  : objective, shared, "god's eye" truth of the world.
 *   RobotContext    : a *derived, per-agent, subjective* view built from that
 *                     world through the agent's own sensors + comms + memory.
 *
 * No agent ever reads WarehouseState directly to make a decision. It reads the
 * RobotContext that IT constructed. Two agents in the same cell therefore
 * construct different contexts and can reach different decisions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  /** radians, 0 = +X, CCW positive */
  theta: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Warehouse / environment
// ─────────────────────────────────────────────────────────────────────────────

export type ZoneKind =
  | 'INBOUND'
  | 'OUTBOUND'
  | 'STORAGE'
  | 'PACKING'
  | 'SORTING'
  | 'CHARGING'
  | 'LOADING'
  | 'AISLE'
  | 'RESTRICTED';

export interface WarehouseZone {
  id: string;
  name: string;
  kind: ZoneKind;
  /** axis-aligned bounds in world metres */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
}

export type WarehouseObjectKind = 'RACK' | 'SHELF' | 'PILLAR' | 'WALL' | 'CRATE' | 'PALLET' | 'CHARGER' | 'CONVEYOR' | 'OBSTACLE';

export interface WarehouseObject {
  id: string;
  kind: WarehouseObjectKind;
  /** centre in world metres */
  x: number;
  y: number;
  /** footprint in metres (axis aligned) */
  w: number;
  h: number;
  /** visual height in metres */
  height: number;
  zoneId?: string;
  /** racks expose pick faces so tasks can reference them */
  pickFace?: { x: number; y: number };
  label?: string;
}

export type PackageState = 'STORED' | 'RESERVED' | 'CARRIED' | 'DELIVERED';

export interface Package {
  id: string;
  /** world position, or null when carried by a robot */
  x: number | null;
  y: number | null;
  state: PackageState;
  /** rack / shelf the package lives on while STORED */
  rackId: string;
  taskId?: string;
  carrierId?: string;
  weightKg: number;
}

export interface Obstacle {
  id: string;
  x: number;
  y: number;
  /** radius in metres */
  r: number;
  kind: 'STATIC' | 'TEMPORARY' | 'SPILL' | 'DEBRIS';
  createdAt: number;
  /** temporary obstacles expire; -1 = permanent */
  ttl: number;
  label?: string;
}

export interface ChargingStation {
  id: string;
  x: number;
  y: number;
  occupiedBy: string | null;
  power: number;
}

/** Navigation graph node = a walkable grid cell. */
export interface NavCell {
  ix: number;
  iy: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────────

export type TaskType = 'PICK_DELIVER' | 'RETRIEVE' | 'REPLENISH' | 'CHARGE_RUN' | 'INSPECT';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type TaskSource = 'MANUAL' | 'GENERATED' | 'SCENARIO';
export type TaskState =
  | 'ANNOUNCED' // broadcast to the fleet, bids being collected
  | 'QUEUED' // no bidder accepted / waiting for capacity
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'REASSIGNING'
  | 'CANCELLED';

export interface TaskBid {
  robotId: string;
  /** lower = better */
  cost: number;
  distance: number;
  battery: number;
  workload: number;
  congestion: number;
  eta: number;
  accepted: boolean;
  rejectedReason?: string;
  at: number;
  /** per-term contribution to the cost, for the allocation ledger UI */
  breakdown: {
    distance: number;
    battery: number;
    workload: number;
    congestion: number;
    eta: number;
    traitScale: number;
    eagerness: number;
    congestionAversion: number;
  };
  /** one-line human-readable justification of this agent's own bid */
  reasoning: string;
}

export interface Task {
  id: string;
  type: TaskType;
  source: TaskSource;
  priority: TaskPriority;
  state: TaskState;
  /** source location (pick) */
  from: { x: number; y: number; label: string; rackId?: string };
  /** destination location (drop) */
  to: { x: number; y: number; label: string };
  packageId?: string;
  assignedTo: string | null;
  /** robots that previously held this task (reassignment lineage) */
  previousAssignees: string[];
  createdAt: number;
  /** when the current auction window opened (re-announcements reset this) */
  announcedAt: number;
  assignedAt?: number;
  startedAt?: number;
  completedAt?: number;
  bids: TaskBid[];
  /** Actual lifecycle and allocation decisions, recorded in simulation time. */
  trace: { at: number; event: string; robotId?: string; detail: string; cost?: number; distance?: number; eta?: number }[];
  allocationReason?: string;
  /** phase inside the robot's execution of the task */
  phase: 'TO_PICK' | 'PICKING' | 'TO_DROP' | 'DROPPING' | 'DONE';
  reassignCount: number;
  failureReason?: string;
  /** capability gates */
  requiresLidar: boolean;
  weightKg: number;
  /** synthetic SLA in seconds from creation */
  slaSeconds: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paths / planning
// ─────────────────────────────────────────────────────────────────────────────

export type PathStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'BLOCKED' | 'REPLANNED' | 'ABORTED';

export interface PathPoint extends Vec2 {
  /** time the robot expects to be here (sim seconds) */
  t?: number;
}

export interface Path {
  id: string;
  robotId: string;
  points: PathPoint[];
  status: PathStatus;
  /** metres */
  length: number;
  cost: number;
  plannedAt: number;
  /** why the previous path died — drives the PURPLE "replanned" visual */
  replanReason?: string;
  generation: number;
  /** how many times this plan has been revised */
  revision: number;
  /** index of the waypoint the robot is currently steering towards */
  cursor: number;
  taskId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Perception — strictly per-agent
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectedRobot {
  id: string;
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  distance: number;
  /** is it inside this agent's safety envelope right now */
  critical: boolean;
  /** who yields, resolved peer-to-peer */
  yieldTo: boolean;
  /** true when this information arrived over comms rather than onboard sensors */
  viaComms: boolean;
  /** seconds since this observation was produced */
  age: number;
  real: boolean;
}

export interface DetectedObstacle {
  id: string;
  x: number;
  y: number;
  r: number;
  distance: number;
  blocksPath: boolean;
}

export interface LocalOccupancy {
  /** grid window around the robot; 1 = believed occupied */
  w: number;
  h: number;
  origin: Vec2;
  cell: number;
  data: Uint8Array;
}

export interface RobotPerception {
  robotId: string;
  at: number;
  radius: number;
  detectedRobots: DetectedRobot[];
  detectedObstacles: DetectedObstacle[];
  detectedStructures: WarehouseObject[];
  /** cells of the *current plan* that are now believed blocked */
  blockedPlanCells: number[];
  localOccupancy: LocalOccupancy;
  /** 0..1 how congested the agent believes its surroundings are */
  localDensity: number;
  /** comms-provided intent of peers (route reservations) */
  peerIntents: PeerIntent[];
  /** true when the onboard sensor model is degraded (e.g. comms scenario) */
  degraded: boolean;
}

export interface PeerIntent {
  robotId: string;
  waypoints: { x: number; y: number; t: number }[];
  priority: number;
  receivedAt: number;
  age: number;
  stale: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Robot state / context / decision
// ─────────────────────────────────────────────────────────────────────────────

export type RobotOperationalStatus =
  | 'IDLE'
  | 'MOVING'
  | 'WAITING'
  | 'PICKING'
  | 'DROPPING'
  | 'CHARGING'
  | 'REROUTING'
  | 'BLOCKED'
  | 'DEGRADED'
  | 'OFFLINE'
  | 'ESTOP'
  | 'BINDING';

export type RobotNavigationState =
  | 'NO_PLAN'
  | 'PLANNING'
  | 'FOLLOWING'
  | 'AVOIDING'
  | 'YIELDING'
  | 'HOLDING'
  | 'ARRIVED'
  | 'PLAN_FAILED';

export type ExecutionMode = 'SIMULATION' | 'PHYSICAL';

export interface RobotState {
  id: string;
  name: string;
  /** SIM or REAL/DEPLOYED — drives the subtle badge treatment */
  real: boolean;
  executionMode: ExecutionMode;
  /** hardware unit id when executionMode === 'PHYSICAL' */
  hardwareId: string | null;

  pose: Pose;
  vx: number;
  vy: number;
  /** m/s along heading */
  speed: number;
  /** rad/s */
  omega: number;
  /** m/s^2 */
  accel: number;

  battery: number;
  payloadKg: number;
  carryingPackageId: string | null;

  status: RobotOperationalStatus;
  navState: RobotNavigationState;

  taskId: string | null;
  taskPhase: Task['phase'] | null;
  destination: Vec2 | null;
  destinationLabel: string | null;
  taskPriority: TaskPriority | null;

  plan: Path | null;
  /** previous plans kept for the "blocked route" ghost visual */
  planHistory: Path[];
  /** travelled trail for the GREEN completed-trajectory visual */
  trail: PathPoint[];

  /** how many tasks this robot has completed this session */
  completedTasks: number;
  replanCount: number;
  distanceTravelled: number;
  /** rolling utilisation 0..1 */
  utilisation: number;

  /** comms health per robot */
  latencyMs: number;
  packetLoss: number;
  lastHeartbeat: number;
  connected: boolean;

  /** safety */
  safetyRadius: number;
  estop: boolean;

  /** agent-declared intent to reach a charger (used in right-of-way) */
  chargingIntentFlag?: boolean;

  /** capability profile (used for hardware compatibility matching) */
  capabilities: RobotCapabilities;

  /** twin synchronisation (physical robots only) */
  twin: DigitalTwinState;

  /** agent-internal memory, not shared */
  memory: RobotMemory;

  /** why the agent is doing what it is doing right now */
  lastDecision: RobotDecision | null;
  decisionHistory: RobotDecision[];

  /** current discrete action issued by the agent */
  action: RobotActionType;

  /** whether the agent believes it is the "owner" of a physical body */
  binding: BindingState;

  colour: string;
}

export interface RobotCapabilities {
  drive: 'DIFFERENTIAL' | 'ACKERMANN' | 'OMNI';
  maxVelocity: number;
  maxAccel: number;
  maxOmega: number;
  payloadKg: number;
  lidar: boolean;
  navigation: boolean;
  requiredTelemetry: string[];
  turningRadius: number;
  footprint: number;
  sensorRange: number;
}

export interface RobotMemory {
  /** cells the agent personally observed as blocked: key `${ix},${iy}` → last seen time */
  knownBlocked: Map<string, number>;
  /** per-peer last known pose, used when comms is degraded */
  peerBelief: Map<string, { x: number; y: number; t: number }>;
  lastPositions: { x: number; y: number; t: number }[];
  /** exponential moving average of how often it has had to yield */
  frustration: number;
  lastReplanAt: number;
  /** id of the peer it is currently yielding to */
  yieldingTo: string | null;
  holdSince: number | null;
  /** number of consecutive ticks stuck despite having a plan */
  stuckTicks: number;
  /** random but deterministic personality bias, per-agent */
  traits: RobotTraits;
}

export interface RobotTraits {
  /** willingness to take detours vs. wait (0..1) */
  assertiveness: number;
  /** battery level at which it self-selects charging (0..1) */
  chargeThreshold: number;
  /** planning cost weight for congestion (0..1) */
  congestionAversion: number;
  /** how aggressively it bids for work (0..1) */
  eagerness: number;
}

/** Per-agent SUBJECTIVE situation model. This is what the agent reasons over. */
export interface RobotContext {
  robotId: string;
  at: number;

  self: {
    pose: Pose;
    speed: number;
    battery: number;
    payloadKg: number;
    status: RobotOperationalStatus;
    navState: RobotNavigationState;
    taskId: string | null;
    taskPriority: TaskPriority | null;
    planRemaining: number;
    planValid: boolean;
    carrying: boolean;
  };

  location: {
    zoneId: string | null;
    zoneKind: ZoneKind | null;
    inAisle: boolean;
    aisleWidth: number;
    atIntersection: boolean;
  };

  traffic: {
    nearbyCount: number;
    nearestRobotDistance: number;
    localDensity: number;
    /** predicted conflicts the agent computed for itself */
    predictedConflicts: ConflictRisk[];
    headingTowardsMe: number;
  };

  obstacles: {
    ahead: DetectedObstacle | null;
    count: number;
    planBlocked: boolean;
    blockedCells: number;
  };

  task: {
    id: string | null;
    type: TaskType | null;
    priority: TaskPriority | null;
    phase: Task['phase'] | null;
    destination: Vec2 | null;
    eta: number | null;
    slaRemaining: number | null;
    atRisk: boolean;
  };

  energy: {
    battery: number;
    needsCharge: boolean;
    reserveMargin: number;
    distanceToNearestCharger: number;
  };

  comms: {
    connected: boolean;
    latencyMs: number;
    packetLoss: number;
    peersHeard: string[];
    degraded: boolean;
  };

  /** human readable summary powering the inspector panel */
  summary: string[];
  /** numeric signature used to prove two contexts differ */
  signature: number;
}

export type RobotActionType =
  | 'IDLE'
  | 'MOVE_FORWARD'
  | 'MOVE_BACKWARD'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'ROTATE'
  | 'STOP'
  | 'WAIT'
  | 'FOLLOW_PATH'
  | 'REROUTE'
  | 'PICK'
  | 'DROP'
  | 'CHARGE'
  | 'HOLD_POSITION'
  | 'YIELD'
  | 'BID'
  | 'ESTOP';

export interface RobotAction {
  type: RobotActionType;
  /** linear velocity target (m/s) */
  v: number;
  /** angular velocity target (rad/s) */
  w: number;
  note?: string;
}

export type DecisionKind =
  | 'CONTINUE'
  | 'MOVE'
  | 'WAIT'
  | 'REROUTE'
  | 'YIELD'
  | 'CHARGE'
  | 'PICK'
  | 'DROP'
  | 'HOLD'
  | 'BID'
  | 'REPLAN_FAILED'
  | 'IDLE';

export interface RobotDecision {
  robotId: string;
  at: number;
  kind: DecisionKind;
  action: RobotAction;
  reason: string;
  /** factors that produced the decision, for the inspector */
  factors: { label: string; value: string; weight?: number }[];
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Traffic / collision
// ─────────────────────────────────────────────────────────────────────────────

export type TrafficKind = 'CONFLICT' | 'CONGESTION' | 'BLOCKED_AISLE' | 'DEADLOCK_RISK' | 'NEAR_MISS' | 'YIELD';

export interface ConflictRisk {
  id: string;
  a: string;
  b: string;
  /** time to closest approach in seconds */
  ttc: number;
  distance: number;
  /** closest point of approach in metres */
  cpa: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  at: Vec2;
  resolved: boolean;
  resolution?: string;
  resolvedBy?: string;
}

export interface TrafficEvent {
  id: string;
  kind: TrafficKind;
  at: number;
  x: number;
  y: number;
  robotIds: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  ttc?: number;
  ttl: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Digital twin / hardware abstraction
// ─────────────────────────────────────────────────────────────────────────────

export type TwinSyncState = 'SYNCED' | 'DRIFTING' | 'STALE' | 'LOST' | 'OFFLINE';

export interface DigitalTwinState {
  robotId: string;
  hardwareId: string | null;
  /** PHYSICAL | MOCK | NONE — never claim mock hardware is real */
  hardwareClass: 'PHYSICAL' | 'MOCK' | 'NONE';
  sync: TwinSyncState;
  /** euclidean error between commanded/virtual pose and reported physical pose */
  positionError: number;
  headingError: number;
  /** one-way telemetry latency */
  latencyMs: number;
  packetLoss: number;
  lastTelemetryAt: number;
  telemetryAge: number;
  packetsReceived: number;
  packetsDropped: number;
  /** authoritative physical pose as reported */
  physicalPose: Pose | null;
  /** what the simulation believed before telemetry arrived */
  virtualPose: Pose | null;
  heartbeatMs: number;
  updateHz: number;
  /** rolling error samples for the sparkline */
  errorHistory: number[];
  batteryReported: number;
}

export type HardwareStatus = 'ONLINE' | 'BUSY' | 'OFFLINE' | 'FAULT' | 'ESTOP';

export interface PhysicalUnit {
  id: string;
  name: string;
  model: string;
  /** MOCK hardware must be labelled as such everywhere */
  mock: boolean;
  status: HardwareStatus;
  battery: number;
  pose: Pose;
  capabilities: RobotCapabilities;
  boundTo: string | null;
  firmware: string;
  transport: 'ROS2_WEBSOCKET' | 'MOCK_BRIDGE' | 'SERIAL';
  endpoint?: string;
}

export type BindingStage =
  | 'IDLE'
  | 'CHECKING'
  | 'COMPATIBILITY_OK'
  | 'COMPATIBILITY_FAIL'
  | 'SAFETY_HOLD'
  | 'STOPPING'
  | 'SYNCHRONISING'
  | 'ACTIVE'
  | 'RELEASING'
  | 'ERROR';

export interface BindingState {
  stage: BindingStage;
  hardwareId: string | null;
  /** hardware class of the currently bound unit */
  hardwareClass: 'PHYSICAL' | 'MOCK' | 'NONE';
  progress: number;
  message: string;
  startedAt: number | null;
  report: CompatibilityReport | null;
  /** commands refused by the safety layer */
  rejectedCommands: number;
  lastRejection?: string;
}

export interface CompatibilityCheck {
  key: string;
  label: string;
  required: string;
  available: string;
  pass: boolean;
}

export interface CompatibilityReport {
  robotId: string;
  hardwareId: string;
  compatible: boolean;
  checks: CompatibilityCheck[];
  score: number;
  reason?: string;
  at: number;
}

export interface Telemetry {
  robotId: string;
  hardwareId: string;
  t: number;
  pose: Pose;
  vx: number;
  vy: number;
  speed: number;
  omega: number;
  battery: number;
  /** onboard proximity scan, n rays */
  scan: number[];
  scanFov: number;
  status: RobotOperationalStatus;
  estop: boolean;
  seq: number;
  /** true when produced by the mock bridge rather than real silicon */
  mock: boolean;
}

export interface RobotCommand {
  robotId: string;
  hardwareId: string;
  seq: number;
  v: number;
  w: number;
  action: RobotActionType;
  t: number;
  /** set by the safety layer before dispatch */
  clamped: boolean;
  clampReason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// System / experiments / events
// ─────────────────────────────────────────────────────────────────────────────

export type NodeStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE';

export interface SystemNode {
  id: string;
  name: string;
  layer: 'AGENT' | 'SIMULATION' | 'GATEWAY' | 'BACKEND' | 'HARDWARE' | 'VISUALISATION';
  status: NodeStatus;
  latencyMs: number;
  heartbeatMs: number;
  packetLoss: number;
  uptime: number;
  detail: string;
  version: string;
}

export type EventSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';

export interface SimEvent {
  id: string;
  at: number;
  /** sim seconds */
  t: number;
  severity: EventSeverity;
  source: string;
  category: 'TASK' | 'AGENT' | 'TRAFFIC' | 'TWIN' | 'SYSTEM' | 'SCENARIO' | 'SAFETY';
  message: string;
  robotId?: string;
  taskId?: string;
  meta?: Record<string, string | number>;
}

export interface ExperimentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  avgCompletionTime: number;
  throughputPerMin: number;
  avgDelay: number;
  nearMisses: number;
  conflictsResolved: number;
  reassignments: number;
  avgReassignmentTime: number;
  replans: number;
  robotUtilisation: number;
  distanceTravelled: number;
  energyConsumed: number;
  slaBreaches: number;
}

export interface ExperimentResult {
  id: string;
  name: string;
  baseline: ExperimentMetrics;
  scenario: ExperimentMetrics;
  scenarioId: string;
  durationSeconds: number;
  /** how many seeded runs were averaged into each arm */
  runs: number;
  at: number;
  notes: string;
}

export interface ScenarioDef {
  id: string;
  name: string;
  code: string;
  description: string;
  /** one-line statement of what the judge should observe */
  demo: string;
  severity: EventSeverity;
  /** triggers automatically at this sim time when scheduled, or on demand */
  autoAt?: number;
}

export interface FleetMetrics {
  activeRobots: number;
  idleRobots: number;
  chargingRobots: number;
  offlineRobots: number;
  avgBattery: number;
  tasksActive: number;
  tasksQueued: number;
  tasksCompleted: number;
  tasksFailed: number;
  throughputPerMin: number;
  avgSpeed: number;
  conflictsActive: number;
  nearMisses: number;
  utilisation: number;
  packetsDropped: number;
  avgLatency: number;
}
