/**
 * FIREBASE REALTIME DATABASE BRIDGE
 *
 * The single, authoritative link between the digital twin and Firebase RTDB.
 * Everything the fleet exposes lives under one root node, `ragha`:
 *
 *   ragha/
 *     robotCount        number of robots in the fleet
 *     updatedAt         ms timestamp of the last fleet metadata write
 *     robots/<robotId>/ virtualState    pose + timestamp + source
 *                       health        battery %, status, sensor/fault, source
 *                       currentTask   taskId, destination, status, pickup
 *                       position      convenient x/y/theta mirror
 *                       location      warehouse zone
 *                       connection    online / heartbeat / last update
 *                       physicalState actual (or mock-labelled) telemetry
 *                       command       operator command IN (separate from telemetry)
 *     racks/<rackId>/   x, y, w, h, pickFace
 *
 * Design rules enforced here:
 *   - Telemetry and commands are separate nodes so a command write can never
 *     clobber telemetry and vice versa.
 *   - Per-robot writes use `update` at `ragha/robots/<id>`; we never `set` the
 *     `ragha` root, so unrelated fields (e.g. `command`) survive a refresh.
 *   - Physical measurements are labelled with their true source; mock hardware
 *     is never presented as real.
 *   - Configuration is optional: until `VITE_FIREBASE_DATABASE_URL` is set every
 *     call is a safe no-op and the warehouse keeps running untouched.
 *
 * Configure the database URL before running (never commit the real value):
 *
 *   // .env.local
 *   VITE_FIREBASE_DATABASE_URL=https://<project>.default.rtdb.firebaseio.com
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase,
  onValue,
  ref,
  set,
  update,
  type Database,
  type Unsubscribe,
} from 'firebase/database';

/**
 * `tsconfig` pins ambient types to `node`, so Vite's `client` typings are not
 * loaded. Declaring them here keeps `import.meta.env` typed without changing
 * the project's global type configuration.
 */
declare global {
  interface ImportMetaEnv {
    readonly VITE_FIREBASE_DATABASE_URL?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL?.trim();

let app: FirebaseApp | null = null;
let database: Database | null = null;
let warned = false;

/** Lazy, idempotent connect — only ever touches Firebase when configured. */
function connect(): Database | null {
  if (database) return database;
  if (!DATABASE_URL) {
    if (!warned) {
      warned = true;
      console.warn('[firebase] VITE_FIREBASE_DATABASE_URL is not set — Firebase reads/writes are disabled.');
    }
    return null;
  }
  try {
    app ??= initializeApp({ databaseURL: DATABASE_URL });
    database = getDatabase(app);
    return database;
  } catch (err) {
    warned = true;
    console.error('[firebase] failed to initialise the Realtime Database:', err);
    return null;
  }
}

export const isFirebaseConfigured = (): boolean => Boolean(DATABASE_URL);

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

/** Where a value came from — never blur simulated with real measurements. */
export type RaghaDataSource = 'SIMULATION' | 'PHYSICAL-ROS2' | 'PHYSICAL-MOCK';

export interface RaghaVirtualState {
  x: number;
  y: number;
  theta: number;
  timestamp: number;
  source: RaghaDataSource;
}

export interface RaghaSensorStatus {
  lidar: boolean;
  healthy: boolean;
}

export interface RaghaHealth {
  /** 0..100 */
  batteryPercentage: number;
  /** °C — null when the platform does not report it */
  internalTempC: number | null;
  status: string;
  sensorStatus: RaghaSensorStatus | null;
  faultCode: string | null;
  updatedAt: number;
  source: RaghaDataSource;
}

export interface RaghaTaskInfo {
  taskId: string | null;
  destination: { x: number; y: number } | null;
  taskStatus: string | null;
  phase: string | null;
  pickup: { x: number; y: number } | null;
  updatedAt: number;
}

export interface RaghaPosition {
  x: number;
  y: number;
  theta: number;
  timestamp: number;
}

export interface RaghaLocation {
  zone: string | null;
  timestamp: number;
}

export interface RaghaConnection {
  online: boolean;
  /** ms epoch of the last sim heartbeat */
  lastHeartbeat: number;
  /** ms epoch of the last successful telemetry write */
  lastSuccessfulUpdate: number;
  source: RaghaDataSource;
}

/** Only present for robots bound to a physical (or mock) body. */
export interface RaghaPhysicalState {
  x: number;
  y: number;
  theta: number;
  speed: number;
  battery: number | null;
  positionError: number;
  sync: string;
  timestamp: number;
  source: 'PHYSICAL-ROS2' | 'PHYSICAL-MOCK';
}

export interface RaghaRobot {
  virtualState: RaghaVirtualState;
  health: RaghaHealth;
  currentTask: RaghaTaskInfo;
  position: RaghaPosition;
  location: RaghaLocation;
  connection: RaghaConnection;
  physicalState?: RaghaPhysicalState;
}

export interface RaghaRack {
  x: number;
  y: number;
  w: number;
  h: number;
  pickFace: { x: number; y: number } | null;
}

export type RaghaCommandType = 'GOTO_WAYPOINT' | 'STOP' | 'ESTOP';

export interface RaghaCommand {
  commandId: string;
  type: RaghaCommandType;
  /** null for STOP / ESTOP */
  targetX: number | null;
  targetY: number | null;
  targetTheta: number | null;
  maxSpeed: number;
  seq: number;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes — telemetry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge a robot's telemetry into `ragha/robots/<robotId>`.
 *
 * Uses `update` (not `set`) so sibling nodes such as `command` are preserved.
 * Returns `false` (with a console error) when Firebase is not configured or the
 * write fails, so callers can treat it as optional telemetry.
 */
export async function publishRaghaRobot(robotId: string, robot: RaghaRobot): Promise<boolean> {
  const db = connect();
  if (!db) return false;
  try {
    await update(ref(db, `ragha/robots/${robotId}`), robot);
    return true;
  } catch (err) {
    console.error(`[firebase] write to /ragha/robots/${robotId} failed:`, err);
    return false;
  }
}

/** Replace the rack catalogue at `ragha/racks`. */
export async function publishRaghaRacks(racks: Record<string, RaghaRack>): Promise<boolean> {
  const db = connect();
  if (!db) return false;
  try {
    await set(ref(db, 'ragha/racks'), racks);
    return true;
  } catch (err) {
    console.error('[firebase] write to /ragha/racks failed:', err);
    return false;
  }
}

/** Merge fleet metadata (robot count + updatedAt) into the `ragha` root. */
export async function publishRaghaFleetMeta(robotCount: number): Promise<boolean> {
  const db = connect();
  if (!db) return false;
  try {
    await update(ref(db, 'ragha'), { robotCount, updatedAt: Date.now() });
    return true;
  } catch (err) {
    console.error('[firebase] write to /ragha (fleet meta) failed:', err);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes — commands (kept strictly separate from telemetry)
// ─────────────────────────────────────────────────────────────────────────────

let commandSeq = 0;

function nextCommandId(): string {
  commandSeq += 1;
  return `${Date.now().toString(36)}-${commandSeq.toString(36)}`;
}

/**
 * Publish an operator command to `ragha/robots/<robotId>/command`.
 *
 * This is the only actuation-facing node. Nothing in the current simulation
 * consumes it — the physical gateway does not read Firebase yet — so writing a
 * command here must never be assumed to move a robot.
 */
export async function publishRobotCommand(robotId: string, command: RaghaCommand): Promise<boolean> {
  const db = connect();
  if (!db) return false;
  try {
    await set(ref(db, `ragha/robots/${robotId}/command`), command);
    return true;
  } catch (err) {
    console.error(`[firebase] write to /ragha/robots/${robotId}/command failed:`, err);
    return false;
  }
}

/** Build and publish a `GOTO_WAYPOINT` command for a selected robot. */
export async function publishGotoCommand(
  robotId: string,
  x: number,
  y: number,
  maxSpeed = 1,
): Promise<boolean> {
  return publishRobotCommand(robotId, {
    commandId: nextCommandId(),
    type: 'GOTO_WAYPOINT',
    targetX: x,
    targetY: y,
    targetTheta: null,
    maxSpeed,
    seq: ++commandSeq,
    timestamp: Date.now(),
  });
}

/**
 * Subscribe to `ragha/robots/<robotId>/command`. Calls `onChange` with the
 * latest command (or `null` when the node does not exist / Firebase is
 * unconfigured). Returns an unsubscribe function.
 */
export function subscribeRobotCommand(
  robotId: string,
  onChange: (command: RaghaCommand | null) => void,
): Unsubscribe {
  const db = connect();
  if (!db) {
    onChange(null);
    return () => {};
  }
  return onValue(ref(db, `ragha/robots/${robotId}/command`), (s) => {
    onChange(s.exists() ? (s.val() as RaghaCommand) : null);
  });
}
