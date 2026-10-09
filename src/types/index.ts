/**
 * NEXUS core data models.
 *
 * Three separations are load-bearing and must never be collapsed:
 *   1. GLOBAL ENVIRONMENT STATE  !=  INDIVIDUAL ROBOT CONTEXT
 *   2. ROBOT AGENT (identity)    !=  EXECUTION BACKEND (body)
 *   3. ROBOT AGENT ID            !=  PHYSICAL HARDWARE ID
 */

/* ------------------------------------------------------------------ geometry */

export interface Vec2 {
  x: number
  z: number
}
export interface Pose extends Vec2 {
  theta: number
}
export interface Rect {
  x: number
  z: number
  w: number
  d: number
}

/* --------------------------------------------------------------- environment */

export type ZoneKind =
  | 'INBOUND'
  | 'OUTBOUND'
  | 'SORTING'
  | 'PACKING'
  | 'CHARGING'
  | 'SAFETY'
  | 'AISLE'

export interface WarehouseZone {
  id: string
  kind: ZoneKind
  label: string
  rect: Rect
  color: string
}

export interface WarehouseObject {
  id: string
  kind: 'RACK' | 'CONVEYOR' | 'CHARGE_STATION' | 'STATION' | 'CRATE' | 'WALL'
  label: string
  rect: Rect
  /** pick face: the free-space point an AMR drives to in order to interact */
  pickFace?: Vec2
  height: number
  /** stack of package ids currently resting here */
  packages: string[]
  /** racks can be reserved by one robot at a time (decentralised, peer-advertised) */
  reservedBy?: string | null
}

export interface Package {
  id: string
  label: string
  locationId: string
  heldBy: string | null
  state: 'STORED' | 'CARRIED' | 'STAGED' | 'SHIPPED'
  weightKg: number
}

export interface Obstacle {
  id: string
  kind: 'STATIC' | 'TEMPORARY'
  rect: Rect
  label: string
  createdAt: number
  expiresAt: number | null
}

/* ------------------------------------------------------------------ planning */

export interface PathPoint extends Vec2 {
  /** world velocity ceiling recommended at this point */
  vmax: number
}

export interface Path {
  id: string
  points: PathPoint[]
  lengthM: number
  /** monotonically increasing whenever the agent replans */
  version: number
  /** how this path came to be */
  origin: 'INITIAL' | 'REPLAN_OBSTACLE' | 'REPLAN_TRAFFIC' | 'REPLAN_TASK' | 'REROUTE'
  blockedAt?: Vec2 | null
  createdAt: number
  costEstimateS: number
}

export interface TrajectoryPoint extends Vec2 {
  t: number
  v: number
}

/* ------------------------------------------------------------ agent identity */

export type ExecutionMode = 'SIMULATION' | 'PHYSICAL' | 'MOCK'

export type AgentStatus =
  | 'IDLE'
  | 'TO_PICK'
  | 'PICKING'
  | 'TO_DROP'
  | 'DROPPING'
  | 'TO_CHARGE'
  | 'CHARGING'
  | 'WAITING'
  | 'REPLANNING'
  | 'BLOCKED'
  | 'E_STOP'
  | 'FAILED'
  | 'OFFLINE'

export type RobotAction =
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

export type DecisionKind =
  | 'CONTINUE'
  | 'YIELD'
  | 'REROUTE'
  | 'SLOW'
  | 'GO_CHARGE'
  | 'PICK_UP'
  | 'DROP_OFF'
  | 'HOLD'
  | 'EMERGENCY_STOP'
  | 'RESUME'

export interface RobotCapabilities {
  driveType: 'DIFFERENTIAL' | 'OMNI' | 'ACKERMANN'
  maxVelocity: number
  maxAccel: number
  maxOmega: number
  maxPayloadKg: number
  sensors: string[]
  navigation: boolean
  telemetry: boolean
  collisionRadius: number
}

export interface RobotDecision {
  action: RobotAction
  kind: DecisionKind
  /** human readable, shown in the command centre — the *why* */
  reason: string
  confidence: number
  at: number
  /** action-specific parameters (v, omega, target, pathId ...) */
  params: Record<string, number | string | null> | null
}

export interface PeerObservation {
  id: string
  pose: Pose
  velocity: number
  executionMode: ExecutionMode
  status: AgentStatus
  taskId: string | null
  distance: number
  bearing: number
  /** range-rate: <0 closing */
  closingRate: number
  /** seconds until closest approach if both continue (null when diverging) */
  ttc: number | null
  /** true when the peer is on a reciprocal/crossing course inside the conflict zone */
  isConflict: boolean
  /** peer has told the mesh it is holding / yielding */
  holding: boolean
}

export interface LocalObstacle {
  id: string
  rect: Rect
  distance: number
  /** cells of this obstacle that actually sit on the agent's current path */
  onPath: boolean
  kind: 'STATIC' | 'TEMPORARY'
}

export interface RobotPerception {
  at: number
  radiusM: number
  sensor: 'LIDAR_2D_360' | 'SIM_GROUND_TRUTH_LIDAR'
  peers: PeerObservation[]
  obstacles: LocalObstacle[]
  zoneId: string | null
  /** free distance straight ahead along the current heading */
  forwardClearance: number
  /** nearest robot/obstacle distance in any direction */
  minClearance: number
  localOccupancy: number
}

export interface CommunicationState {
  channel: 'SIM_MESH' | 'GATEWAY_LINK'
  peersInRange: string[]
  lastBroadcastAt: number
  broadcastHz: number
  messageCount: number
  linkQuality: number
  /** ms */
  latencyMs: number
  received: AgentIntent[]
}

export interface AgentIntent {
  from: string
  at: number
  kind: 'ROUTE_RESERVATION' | 'YIELD' | 'TASK_CLAIM' | 'HEARTBEAT' | 'OBSTACLE_REPORT'
  payload: Record<string, number | string | boolean | null>
}

/**
 * The agent's own view of the world. Two agents must never share one of these.
 * This object is rebuilt every decision cycle from perception + memory + task state.
 */
export interface RobotContext {
  agentId: string
  at: number
  pose: Pose
  velocity: number
  battery: number
  payloadKg: number
  carrying: string | null
  loaded: boolean
  zoneId: string | null
  perception: RobotPerception
  task: TaskContext | null
  route: RouteContext | null
  traffic: TrafficContext
  communication: CommunicationState
  capabilities: RobotCapabilities
  executionMode: ExecutionMode
  hardwareId: string | null
  memory: {
    lastAction: RobotAction | null
    lastDecision: DecisionKind | null
    actionsTaken: number
    replans: number
    yields: number
    blockedSeconds: number
    heldSeconds: number
    completedTasks: number
    lastPreemptedAt: number
    lastStuckReplanAt: number
  }
  /** per-agent behavioural profile — why R02 and R03 differ on identical input */
  traits: AgentTraits
}

export interface AgentTraits {
  /** 0 = rush everything, 1 = maximum caution */
  caution: number
  /** willingness to trade route length for time (0..1) */
  patience: number
  /** detour penalty threshold an agent will accept before simply waiting */
  rerouteTolerance: number
  /** battery level at which the agent insists on charging */
  chargeThreshold: number
  /** preferred cruise fraction of max velocity */
  speedBias: number
  /** seconds of conflict horizon the agent reacts to */
  lookaheadS: number
  /** label used in the UI */
  profile: string
}

export interface TaskContext {
  taskId: string
  step: number
  totalSteps: number
  targetId: string
  targetKind: 'PICK' | 'DROP' | 'CHARGE'
  targetPose: Vec2
  priority: TaskPriority
  ageS: number
  deadlineS: number | null
}

export interface RouteContext {
  pathId: string
  version: number
  nextIndex: number
  remainingM: number
  estimatedS: number
  blocked: boolean
  blockedBy: string | null
  origin: Path['origin']
  destinationsRemaining: number
}

export interface TrafficContext {
  density: number
  conflicts: { peerId: string; ttc: number; at: Vec2; severity: number }[]
  congestion: number
  waitingPeers: string[]
  yieldTo: string | null
}

/* ---------------------------------------------------------------- task model */

export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'

export type TaskStatus =
  | 'QUEUED'
  | 'EVALUATING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'REASSIGNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export interface TaskStep {
  kind: 'PICK' | 'DROP' | 'CHARGE'
  targetId: string
  label: string
  pose: Vec2
  status: 'PENDING' | 'ACTIVE' | 'DONE'
}

export interface Task {
  id: string
  label: string
  priority: TaskPriority
  status: TaskStatus
  steps: TaskStep[]
  currentStep: number
  packageId: string | null
  assignedTo: string | null
  assignedAt: number | null
  createdAt: number
  completedAt: number | null
  /** every agent that evaluated this task, with its bid and reasoning */
  evaluation: TaskBid[]
  history: { at: number; event: string; detail?: string }[]
  requestedBy: 'DEMO' | 'OPERATOR' | 'SCHEDULER'
  reassignmentCount: number
}

export interface TaskBid {
  agentId: string
  cost: number
  distanceM: number
  battery: number
  workload: number
  etaS: number
  congestionPenalty: number
  capable: boolean
  accepted: boolean
  note: string
}

/* --------------------------------------------------------------- traffic */

export interface TrafficEvent {
  id: string
  at: number
  kind: 'CONFLICT' | 'CONGESTION' | 'BLOCKED_AISLE' | 'COLLISION_AVOIDED' | 'YIELD' | 'NEAR_MISS'
  agents: string[]
  position: Vec2
  ttc: number | null
  severity: number
  resolvedBy: 'YIELD' | 'REROUTE' | 'SLOW' | 'PENDING' | 'AVOIDED'
  detail: string
}

export interface CollisionRisk {
  a: string
  b: string
  distance: number
  ttc: number | null
  at: Vec2
  severity: number
}

/* ----------------------------------------------------- execution / hardware */

export interface RobotExecutionBackend {
  readonly id: string
  readonly kind: ExecutionMode
  readonly label: string
  /** true when commands leave the process for real hardware */
  readonly isRemote: boolean
  attachedAgentId: string | null
  attach(agentId: string, profile: AgentProfile): void
  detach(): void
  /** dispatch one validated agent action to this body */
  dispatch(cmd: MotionCommand): void
  stop(reason: string): void
  emergencyStop(on: boolean): void
  dispose(): void
}

/** Low-level body command — the sim-to-real contract. */
export interface MotionCommand {
  seq: number
  ts: number
  v: number
  omega: number
  /** high-level intent that produced this command, for the hardware log */
  action: RobotAction
  kind: DecisionKind
  clearanceM: number
  eStop: boolean
}

export interface AgentProfile {
  agentId: string
  capabilities: RobotCapabilities
  homeZone: string
}

export type HardwareStatus = 'OFFLINE' | 'ONLINE' | 'BUSY' | 'ERROR'

export interface HardwareCapability {
  driveType: RobotCapabilities['driveType']
  maxVelocity: number
  maxAccel: number
  maxOmega: number
  payloadKg: number
  sensors: string[]
  navigation: boolean
  telemetry: boolean
}

export interface PhysicalHardware {
  id: string
  label: string
  status: HardwareStatus
  /** transport actually carrying commands — displayed verbatim, never faked */
  transport: 'MOCK_GATEWAY' | 'ROS2_BRIDGE' | 'SERIAL_GATEWAY' | 'WS_GATEWAY'
  isRealHardware: boolean
  battery: number
  capabilities: HardwareCapability
  firmware: string
  boundAgentId: string | null
  lastSeenAt: number
  /** simulation clock (seconds) of the last telemetry frame */
  lastSeenSim: number
  position: Pose
  velocity: number
  /** ms round trip measured by the gateway */
  latencyMs: number
  packetLoss: number
  heartbeatHz: number
  safetyState: SafetyState
}

export interface HardwareBinding {
  agentId: string
  hardwareId: string
  status: 'UNBOUND' | 'VALIDATING' | 'BINDING' | 'BOUND' | 'UNBINDING' | 'DEGRADED' | 'LOST'
  boundAt: number | null
  compatibility: CompatibilityResult | null
  safety: SafetyResult | null
  syncState: 'IDLE' | 'SYNCING' | 'SYNCED' | 'DEGRADED' | 'LOST'
  lastTelemetryAt: number | null
  commandsDispatched: number
  commandsRejected: number
  positionErrorM: number
}

export interface CompatibilityResult {
  compatible: boolean
  checks: { capability: string; required: string; available: string; pass: boolean }[]
  reasons: string[]
}

export interface SafetyResult {
  pass: boolean
  checks: { rule: string; value: string; limit: string; pass: boolean }[]
  violations: string[]
}

export interface SafetyState {
  armed: boolean
  eStop: boolean
  lastValidationAt: number
  violations: number
  rejectedCommands: number
  /** highest commanded velocity accepted, m/s */
  velocityCeiling: number
}

/* ------------------------------------------------------------ digital twin */

export interface Telemetry {
  agentId: string
  hardwareId: string
  seq: number
  emittedAt: number
  receivedAt: number
  /** physical state is authoritative for the twin's ACTUAL pose */
  pose: Pose
  velocity: number
  omega: number
  battery: number
  motorCurrentA: number
  bumperTripped: boolean
  lidarHealthy: boolean
  estop: boolean
  linkQuality: number
  latencyMs: number
  wheelSlipEstimate: number
}

export interface DigitalTwinState {
  agentId: string
  hardwareId: string
  online: boolean
  syncState: HardwareBinding['syncState']
  /** where the agent's planner thinks the body should be */
  plannedPose: Pose
  /** where the body actually is, per telemetry */
  actualPose: Pose
  positionErrorM: number
  headingErrorRad: number
  telemetry: Telemetry | null
  telemetryAgeMs: number
  plannedTrajectory: TrajectoryPoint[]
  actualTrajectory: TrajectoryPoint[]
  latencyMs: number
  packetLoss: number
  mode: ExecutionMode
}

/* ------------------------------------------------------------ experiments */

export interface ExperimentResult {
  id: string
  scenarioId: string
  scenarioLabel: string
  startedAt: number
  durationS: number
  metrics: ExperimentMetrics
  baseline: ExperimentMetrics | null
}

export interface ExperimentMetrics {
  tasksCompleted: number
  throughputPerHour: number
  avgTaskTimeS: number
  avgDelayS: number
  collisions: number
  nearMisses: number
  robotUtilization: number
  replanCount: number
  yieldCount: number
  reassignmentCount: number
  avgReassignmentS: number
  avgSyncLatencyMs: number
  deploymentTimeS: number | null
  distanceTravelledM: number
}

/* ------------------------------------------------------------------ system */

export type NodeStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'NOT_CONNECTED'

export interface SystemNode {
  id: string
  label: string
  kind: 'SIM' | 'AGENT' | 'BACKEND' | 'GATEWAY' | 'ROS2' | 'HARDWARE' | 'BUS'
  status: NodeStatus
  detail: string
  latencyMs: number | null
  heartbeatHz: number | null
  packetLoss: number | null
}

/* ------------------------------------------------------------- sim snapshot */

export interface RobotSnapshot {
  id: string
  label: string
  pose: Pose
  velocity: number
  battery: number
  status: AgentStatus
  executionMode: ExecutionMode
  hardwareId: string | null
  taskId: string | null
  taskLabel: string | null
  decision: RobotDecision | null
  routeVersion: number
  payloadKg: number
  carrying: string | null
  caution: number
  profile: string
  blockedBy: string | null
  fault: string | null
  twin: DigitalTwinState | null
  hardwareStatus: HardwareStatus | null
  compat: boolean
}

export interface SimMetrics {
  simTimeS: number
  wallClockS: number
  speed: number
  running: boolean
  tasksCompleted: number
  tasksActive: number
  tasksQueued: number
  throughputPerHour: number
  fleetUtilization: number
  avgTaskTimeS: number
  collisionCount: number
  nearMissCount: number
  replanCount: number
  yieldCount: number
  reassignmentCount: number
  distanceTravelledM: number
  avgDecisionLatencyMs: number
  linkLatencyMs: number
  activeConflicts: number
}

export interface SimEvent {
  id: string
  at: number
  wall: number
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'CRITICAL' | 'DECISION'
  source: string
  message: string
  detail?: string
}
