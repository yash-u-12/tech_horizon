/**
 * Route visualisation.
 *
 * Colour semantics (per spec §10):
 *   CYAN    planned / active route
 *   GREEN   completed trajectory
 *   AMBER   waiting / caution segments
 *   RED     blocked / invalidated route (the ghost left behind)
 *   PURPLE  replanned route
 *
 * Geometry is refreshed every frame from the agent's live plan objects, so what
 * you see is the plan the agent is actually executing right now.
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { RobotState } from '@/simulation/types';
import { tx, tz, PATH_COLORS } from './shared';

const MAX_POINTS = 512;
const Y = 0.045;

interface LineProps {
  getPoints: () => { x: number; y: number }[] | null;
  color: string;
  width: number;
  opacity?: number;
  dashed?: boolean;
  y?: number;
  empty?: THREE.Vector3[];
}

function DynamicLine({ getPoints, color, width, opacity = 1, dashed = false, y = Y }: LineProps) {
  const ref = useRef<any>(null);
  const buf = useMemo(() => new Float32Array(MAX_POINTS * 3), []);

  useFrame(() => {
    const line = ref.current;
    if (!line) return;
    const pts = getPoints();
    if (!pts || pts.length < 2) {
      line.visible = false;
      return;
    }
    const n = Math.min(pts.length, MAX_POINTS);
    for (let i = 0; i < n; i++) {
      buf[i * 3] = tx(pts[i].x);
      buf[i * 3 + 1] = y;
      buf[i * 3 + 2] = tz(pts[i].y);
    }
    const arr = buf.subarray(0, n * 3);
    line.geometry.setPositions(arr);
    line.geometry.instanceCount = n - 1;
    line.computeLineDistances?.();
    line.visible = true;
  });

  return (
    <Line
      ref={ref}
      points={[
        [0, 0, 0],
        [0, 0, 0],
      ]}
      color={color}
      lineWidth={width}
      transparent
      opacity={opacity}
      dashed={dashed}
      dashSize={dashed ? 0.34 : undefined}
      gapSize={dashed ? 0.26 : undefined}
    />
  );
}

export function RobotPaths({ state, showTrail }: { state: RobotState; showTrail: boolean }) {
  // ── active plan: cyan, or purple when it was just revised ────────────────
  const planColor = useMemo(() => {
    const p = state.plan;
    if (!p) return PATH_COLORS.ACTIVE;
    if (p.revision > 1 && state.status === 'REROUTING') return PATH_COLORS.REPLANNED;
    return PATH_COLORS.ACTIVE;
  }, [state.plan?.revision, state.status, state.plan]);

  const getPlan = () => {
    const p = state.plan;
    if (!p || p.points.length < 2) return null;
    return [{ x: state.pose.x, y: state.pose.y }, ...p.points.slice(Math.min(p.cursor, p.points.length - 1))];
  };

  const getTrail = () => (showTrail ? state.trail : null);

  const getHistory0 = () => state.planHistory[0]?.points ?? null;
  const getHistory1 = () => state.planHistory[1]?.points ?? null;

  return (
    <group>
      {/* completed trajectory */}
      <DynamicLine getPoints={getTrail} color={PATH_COLORS.COMPLETED} width={1.1} opacity={0.34} y={0.03} />
      {/* superseded routes */}
      <DynamicLine getPoints={getHistory1} color={PATH_COLORS.BLOCKED} width={1.4} opacity={0.2} dashed y={0.035} />
      <DynamicLine getPoints={getHistory0} color={PATH_COLORS.BLOCKED} width={1.8} opacity={0.42} y={0.038} />
      {/* the route being executed */}
      <DynamicLine getPoints={getPlan} color={planColor} width={2.4} opacity={0.92} y={0.05} />
    </group>
  );
}

/** Destination marker for the selected robot. */
export function DestinationMarker({ state }: { state: RobotState }) {
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    const d = state.destination;
    if (!d) {
      g.visible = false;
      return;
    }
    g.visible = true;
    g.position.set(tx(d.x), 0.05, tz(d.y));
    if (ring.current) {
      const t = (clock.elapsedTime % 1.4) / 1.4;
      const s = 0.4 + t * 1.1;
      ring.current.scale.set(s, s, 1);
      const m = ring.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.6 * (1 - t);
    }
  });
  return (
    <group ref={ref}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <ringGeometry args={[0.3, 0.4, 24]} />
        <meshBasicMaterial color="#38BDF8" transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <ringGeometry args={[0.3, 0.36, 24]} />
        <meshBasicMaterial color="#38BDF8" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 12]} />
        <meshBasicMaterial color="#38BDF8" transparent opacity={0.8} depthWrite={false} />
      </mesh>
    </group>
  );
}
