import type {
  AgentIntent,
  AgentTraits,
  ExecutionMode,
  Obstacle,
  Package,
  RobotCapabilities,
  Task,
  Vec2,
  WarehouseObject,
  WarehouseZone,
} from '../types'
import { OccupancyGrid } from './environment/occupancy'
import type { PerceivablePeer } from './perception/perception'

/**
 * The interface an agent uses to touch the *shared* world. Agents never reach
 * into the engine directly: everything they can learn or change goes through
 * this surface, which keeps agent code independent from the simulation runtime
 * (and from the UI).
 */
export interface WorldAccess {
  /** simulated seconds since NEXUS boot */
  now: number
  wallClockMs: number
  speedFactor: number
  grid: OccupancyGrid
  objects: WarehouseObject[]
  zones: WarehouseZone[]
  obstacles: Obstacle[]
  packages: Map<string, Package>

  /** every other agent's minimal, *observable* state */
  perceivablePeers: (selfId: string) => PerceivablePeer[]

  /** peer-to-peer mesh: range-limited, latency-simulated intent exchange */
  broadcast: (intent: AgentIntent, position: Vec2) => void
  inbox: (agentId: string) => AgentIntent[]

  /** shared mesh occupancy hint from peer intent (route reservations, holds) */
  congestionField: () => Float32Array | null
  peerReservations: () => { agentId: string; cells: { x: number; z: number }[]; at: number }[]

  /** tasks */
  openTasks: () => Task[]
  releaseTask: (taskId: string, agentId: string, reason: string) => void
  reassignTask: (taskId: string, failedAgentId: string, reason: string) => void
  completeTask: (taskId: string, agentId: string) => void
  advanceTaskStep: (taskId: string, agentId: string, detail: string) => void
  taskById: (taskId: string) => Task | undefined

  /** world mutation */
  setPackageState: (packageId: string, state: Package['state'], locationId: string, heldBy: string | null) => void
  reserveObject: (objectId: string, agentId: string | null) => void
  setObstacle: (obstacle: Obstacle) => void
  clearObstacle: (id: string) => void

  /** log + faults + metrics hooks */
  log: (level: 'INFO' | 'SUCCESS' | 'WARN' | 'CRITICAL' | 'DECISION', source: string, message: string, detail?: string) => void
  onAgentFault: (agentId: string, reason: string) => void

  /** deterministic RNG shared by the scenario layer */
  rng: () => number
  /** idle destination for an agent (standby post, or an experiment override) */
  standbyOf: (agentId: string) => Vec2

  /** fixed agent metadata */
  capabilitiesOf: (agentId: string) => RobotCapabilities
  traitsOf: (agentId: string) => AgentTraits
  modeOf: (agentId: string) => ExecutionMode
  /** agents that currently cannot move (failed / offline) */
  isAgentAvailable: (agentId: string) => boolean
  /** move a temporary obstacle so scenarios stay deterministic */
  spawnTemporaryObstacle: (rect: { x: number; z: number; w: number; d: number }, label: string, ttlS: number) => Obstacle
}
