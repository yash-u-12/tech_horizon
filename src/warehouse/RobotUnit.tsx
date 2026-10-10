/**
 * A single AMR in the warehouse.
 *
 * Reads its mutable RobotState directly inside useFrame — never through React
 * state — so twelve robots stay perfectly smooth at 60 fps while the panels
 * refresh at 10 Hz.
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { RobotState } from '@/simulation/types';
import { tx, tz, tRot, statusColor } from './shared';

interface Props {
  state: RobotState;
  selected: boolean;
  hovered: boolean;
  /** live pointer into the agent's perception (mutated in place) */
  perception?: { detectedObstacles: { x: number; y: number; r: number }[] };
  showLabel: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

export function RobotUnit({ state, selected, hovered, showLabel, onSelect, onHover }: Props) {
  const group = useRef<THREE.Group>(null);
  const bodyGlow = useRef<THREE.Mesh>(null);
  const statusLight = useRef<THREE.MeshStandardMaterial>(null);
  const lidar = useRef<THREE.Mesh>(null);
  const linkRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const colour = useMemo(() => new THREE.Color(state.colour), [state.colour]);
  const isPhysical = state.executionMode === 'PHYSICAL';
  const highlight = selected || hovered;

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    g.position.x = tx(state.pose.x);
    g.position.z = tz(state.pose.y);
    g.rotation.y = tRot(state.pose.theta);

    // status beacon: colour follows the agent's own operational state
    if (statusLight.current) {
      const c = statusColor(state.status);
      statusLight.current.color.set(c);
      statusLight.current.emissive.set(c);
      const pulse =
        state.status === 'MOVING' ? 0.55 + 0.45 * Math.sin(clock.elapsedTime * 6)
          : state.status === 'WAITING' ? 0.35 + 0.35 * Math.sin(clock.elapsedTime * 2.4)
            : state.status === 'OFFLINE' ? 0.15 + 0.5 * (Math.sin(clock.elapsedTime * 8) > 0 ? 1 : 0)
              : 0.7;
      statusLight.current.emissiveIntensity = pulse;
    }
    if (lidar.current) lidar.current.rotation.y += 0.09;
    if (bodyGlow.current) {
      const m = bodyGlow.current.material as THREE.MeshBasicMaterial;
      m.opacity = highlight ? 0.3 : state.estop ? 0.26 : 0.1;
    }
    if (ringRef.current) {
      const m = ringRef.current.material as THREE.MeshBasicMaterial;
      const base = selected ? 0.5 : isPhysical ? 0.28 : 0.0;
      m.opacity = base + 0.12 * Math.sin(clock.elapsedTime * 3);
    }
    if (linkRef.current) {
      linkRef.current.visible = isPhysical;
    }
  });

  const s = 0.78; // chassis length (m) — a compact AMR

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(state.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(state.id);
      }}
      onPointerOut={() => onHover(null)}
    >
      {/* ground marker / selection ring */}
      <mesh ref={ringRef} position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.52, 0.66, 32]} />
        <meshBasicMaterial
          color={state.estop ? '#EF4444' : selected ? '#38BDF8' : isPhysical ? '#34D399' : '#38BDF8'}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* shadow blob */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.46, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.34} depthWrite={false} />
      </mesh>

      {/* chassis */}
      <mesh position={[0, 0.11, 0]} castShadow receiveShadow>
        <boxGeometry args={[s, 0.18, 0.56]} />
        <meshStandardMaterial color="#1A222C" roughness={0.55} metalness={0.55} />
      </mesh>
      {/* accent trim (per-agent colour) */}
      <mesh position={[0, 0.055, 0]}>
        <boxGeometry args={[s - 0.04, 0.045, 0.6]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.42} roughness={0.4} />
      </mesh>
      {/* top deck */}
      <mesh position={[-0.02, 0.215, 0]} castShadow>
        <boxGeometry args={[s - 0.16, 0.045, 0.5]} />
        <meshStandardMaterial color="#232E3A" roughness={0.6} metalness={0.45} />
      </mesh>

      {/* payload */}
      {state.carryingPackageId && (
        <mesh position={[-0.02, 0.31, 0]} castShadow>
          <boxGeometry args={[0.4, 0.16, 0.38]} />
          <meshStandardMaterial color="#8A6A44" roughness={0.9} />
        </mesh>
      )}

      {/* wheels */}
      {[
        [s * 0.3, 0.3],
        [s * 0.3, -0.3],
        [-s * 0.3, 0.3],
        [-s * 0.3, -0.3],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.055, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.045, 12]} />
          <meshStandardMaterial color="#0B0F15" roughness={0.95} />
        </mesh>
      ))}

      {/* front heading arrow */}
      <mesh position={[s * 0.5 + 0.03, 0.13, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.075, 0.14, 4]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.6} />
      </mesh>

      {/* sensor mast + lidar */}
      <mesh position={[s * 0.28, 0.3, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.19, 10]} />
        <meshStandardMaterial color="#2A3441" roughness={0.5} metalness={0.6} />
      </mesh>
      <mesh ref={lidar} position={[s * 0.28, 0.415, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.055, 14]} />
        <meshStandardMaterial color="#0F151D" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* status beacon */}
      <mesh position={[-s * 0.28, 0.26, 0]}>
        <cylinderGeometry args={[0.042, 0.042, 0.07, 10]} />
        <meshStandardMaterial ref={statusLight} color="#38BDF8" emissive="#38BDF8" emissiveIntensity={0.7} />
      </mesh>

      {/* selection halo */}
      {highlight && (
        <mesh ref={bodyGlow} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.95, 32]} />
          <meshBasicMaterial color={selected ? '#38BDF8' : '#93A3B4'} transparent opacity={0.16} depthWrite={false} />
        </mesh>
      )}

      {/* ── digital-twin link: physical body ↔ virtual twin ───────────────── */}
      <group ref={linkRef}>
        <mesh position={[0, 0.9, 0]}>
          <boxGeometry args={[0.012, 0.62, 0.012]} />
          <meshBasicMaterial color="#34D399" transparent opacity={0.5} />
        </mesh>
        <mesh position={[0, 1.26, 0]} rotation={[Math.PI / 4, Math.PI / 4, 0]}>
          <boxGeometry args={[0.11, 0.11, 0.11]} />
          <meshBasicMaterial color="#34D399" transparent opacity={0.82} />
        </mesh>
      </group>

      {/* ── label ─────────────────────────────────────────────────────────── */}
      {(showLabel || highlight) && (
        <Html position={[0, 1.55, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <RobotBadge state={state} selected={selected} />
        </Html>
      )}
    </group>
  );
}

function RobotBadge({ state, selected }: { state: RobotState; selected: boolean }) {
  const bat = Math.round(state.battery);
  const batColor = bat > 45 ? '#34D399' : bat > 22 ? '#FBBF24' : '#F87171';
  const isPhysical = state.executionMode === 'PHYSICAL';
  return (
    <div
      className="pointer-events-none select-none whitespace-nowrap rounded-[3px] border px-1.5 py-[3px] font-mono text-[9px] leading-tight"
      style={{
        background: 'rgba(7,9,12,0.86)',
        borderColor: selected ? 'rgba(56,189,248,0.6)' : 'rgba(38,51,63,0.9)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold tracking-wider text-txt">{state.id}</span>
        <span
          className="rounded-[2px] px-1 text-[8px] font-bold tracking-wider"
          style={{
            color: isPhysical ? '#34D399' : '#93A3B4',
            background: isPhysical ? 'rgba(52,211,153,0.13)' : 'rgba(148,163,184,0.1)',
          }}
        >
          {isPhysical ? (state.twin.hardwareClass === 'MOCK' ? 'REAL·MOCK' : 'REAL') : 'SIM'}
        </span>
      </div>
      <div className="mt-[2px] flex items-center gap-1.5 text-[8px] tracking-wider">
        <span style={{ color: statusColor(state.status) }}>{state.status}</span>
        <span style={{ color: batColor }}>{bat}%</span>
        {state.taskId && <span className="text-txt3">{state.taskId.replace('TASK-', 'T')}</span>}
      </div>
    </div>
  );
}

/** Dashed line used for the twin-link and hazard indicators. */
export function LinkLine({ points, color }: { points: [number, number, number][]; color: string }) {
  return <Line points={points} color={color} lineWidth={1} dashed dashSize={0.18} gapSize={0.12} transparent opacity={0.7} />;
}
