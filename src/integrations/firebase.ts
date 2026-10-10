/**
 * FIREBASE REALTIME DATABASE BRIDGE
 *
 * One-way telemetry out of the digital twin: coordinates chosen in the 3D scene
 * are published to Firebase RTDB so external dashboards can see where the
 * operator told a robot to go. The helper also supports subscribing back so a
 * remote client can park the twin at a target.
 *
 * Configure the database URL before running (never commit the real value):
 *
 *   // .env.local
 *   VITE_FIREBASE_DATABASE_URL=https://<project>.default.rtdb.firebaseio.com
 *
 * Until that variable is set every publish/subscribe is a safe no-op and the
 * warehouse keeps running untouched.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, onValue, ref, set, type Database, type Unsubscribe } from 'firebase/database';

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

export interface RobotTarget {
  x: number;
  y: number;
  timestamp: number;
}

/**
 * Write a target to `/robots/<robotId>/target` as `{ x, y, timestamp }`.
 * Returns `false` (with a console error) when Firebase is not configured or
 * the write fails, so callers can treat it as optional telemetry.
 */
export async function publishRobotTarget(robotId: string, x: number, y: number): Promise<boolean> {
  const db = connect();
  if (!db) return false;
  try {
    const payload: RobotTarget = { x, y, timestamp: Date.now() };
    await set(ref(db, `robots/${robotId}/target`), payload);
    return true;
  } catch (err) {
    console.error(`[firebase] write to /robots/${robotId}/target failed:`, err);
    return false;
  }
}

/**
 * Subscribe to `/robots/<robotId>/target`. Calls `onChange` with the latest
 * target (or `null` when the node does not exist / Firebase is unconfigured).
 * Returns an unsubscribe function.
 */
export function subscribeRobotTarget(robotId: string, onChange: (target: RobotTarget | null) => void): Unsubscribe {
  const db = connect();
  if (!db) {
    onChange(null);
    return () => {};
  }
  return onValue(ref(db, `robots/${robotId}/target`), (s) => {
    onChange(s.exists() ? (s.val() as RobotTarget) : null);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export interface RobotStateSample {
  x: number;
  y: number;
  theta: number;
  timestamp: number;
}

/**
 * Stream a live pose to `/robots/<robotId>/state` as
 * `{ x, y, theta, timestamp }` so a physical robot can mirror it.
 *
 * Callers must throttle: the render loop runs at ~60 Hz. A 100 ms cadence
 * (~10 Hz, matching the simulation snapshot rate) is plenty for mirroring.
 */
export async function publishRobotState(robotId: string, x: number, y: number, theta: number): Promise<boolean> {
  const db = connect();
  if (!db) return false;
  try {
    const payload: RobotStateSample = { x, y, theta, timestamp: Date.now() };
    await set(ref(db, `robots/${robotId}/state`), payload);
    return true;
  } catch (err) {
    console.error(`[firebase] write to /robots/${robotId}/state failed:`, err);
    return false;
  }
}