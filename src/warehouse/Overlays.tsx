/**
 * Analytical overlays: perception, occupancy, traffic events and obstacles.
 *
 * These exist to make the agents' internal state legible in SPACE rather than
 * only in side panels — the whole point of a digital twin.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { RobotAgent } from '@/simulation/agents/agent';
import type { Snapshot } from '@/simulation/engine';
import { tx, tz } from './shared';

// ─────────────────────────────────────────────────────────────────────────────

export function PerceptionOverlay({
  agent,
  showOccupancy,
  showLinks,
}: {
  agent: RobotAgent | null;
  showOccupancy: boolean;
  showLinks: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const occRef = useRef<THREE.Mesh>(null);
  const texture = useMemo(() => {
    const d = new Uint8Array(19 * 19 * 4);
    const t = new THREE.DataTexture(d, 19, 19, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }, []);
  const [links, setLinks] = useState<[number, number, number][][]>([]);
  const acc = useRef(0);

  useFrame((_, dt) => {
    const g = group.current;
    if (!agent || !g) {
      if (g) g.visible = false;
      return;
    }
    g.visible = true;
    const s = agent.state;
    g.position.set(tx(s.pose.x), 0, tz(s.pose.y));
    if (ring.current) {
      const m = ring.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.1 + (agent.perception?.degraded ? 0.05 : 0.12);
    }

    // refresh the links + occupancy at 6 Hz (they do not need 60 Hz)
    acc.current += dt;
    if (acc.current > 0.16) {
      acc.current = 0;
      const p = agent.perception;
      if (p) {
        if (showLinks) {
          setLinks(
            p.detectedRobots
              .filter((r) => r.distance < p.radius)
              .map((r) => [
                [tx(s.pose.x), 0.32, tz(s.pose.y)],
                [tx(r.x), 0.32, tz(r.y)],
              ] as [number, number, number][]),
          );
        } else setLinks([]);

        if (showOccupancy && occRef.current) {
          const occ = p.localOccupancy;
          const n = occ.w;
          const data = texture.image.data as Uint8Array;
          // rebuild at the texture's fixed resolution by nearest sampling
          const src = occ.data;
          for (let j = 0; j < 19; j++) {
            for (let i = 0; i < 19; i++) {
              const si = Math.min(n - 1, Math.floor((i / 19) * n));
              const sj = Math.min(n - 1, Math.floor((j / 19) * n));
              const v = src[sj * n + si];
              const o = (j * 19 + i) * 4;
              data[o] = v ? 248 : 56;
              data[o + 1] = v ? 113 : 189;
              data[o + 2] = v ? 113 : 248;
              data[o + 3] = v ? 120 : 34;
            }
          }
          texture.needsUpdate = true;
          const size = n * occ.cell;
          occRef.current.scale.set(size, size, 1);
        }
      }
    }
  });

  if (!agent) return null;
  const radius = agent.state.capabilities.sensorRange;

  return (
    <group ref={group}>
      {/* sensor footprint */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color="#38BDF8" transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
        <ringGeometry args={[radius - 0.03, radius, 64]} />
        <meshBasicMaterial color="#38BDF8" transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* safety envelope */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.024, 0]}>
        <ringGeometry args={[agent.state.safetyRadius * 2 - 0.03, agent.state.safetyRadius * 2, 40]} />
        <meshBasicMaterial color="#F87171" transparent opacity={0.42} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {showOccupancy && (
        <mesh ref={occRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} />
        </mesh>
      )}

      {links.map((pts, i) => (
        <Line key={i} points={pts} color="#38BDF8" lineWidth={1} transparent opacity={0.34} dashed dashSize={0.2} gapSize={0.14} />
      ))}

      {/* obstacles this agent individually detected */}
      {(agent.perception?.detectedObstacles ?? []).map((o) => (
        <mesh key={o.id} position={[tx(o.x) - group.current!.position.x, 0.05, tz(o.y) - group.current!.position.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[o.r + 0.1, o.r + 0.2, 24]} />
          <meshBasicMaterial color={o.blocksPath ? '#F87171' : '#FBBF24'} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Obstacles({ obstacles }: { obstacles: Snapshot['obstacles'] }) {
  return (
    <group>
      {obstacles.map((o) => {
        const spill = o.kind === 'SPILL';
        return (
          <group key={o.id} position={[tx(o.x), 0, tz(o.y)]}>
            <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[o.r, 20]} />
              <meshBasicMaterial color={spill ? '#FBBF24' : '#F87171'} transparent opacity={0.3} depthWrite={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.052, 0]}>
              <ringGeometry args={[o.r - 0.05, o.r, 24]} />
              <meshBasicMaterial color={spill ? '#FBBF24' : '#F87171'} transparent opacity={0.85} side={THREE.DoubleSide} />
            </mesh>
            {!spill && (
              <mesh position={[0, 0.3, 0]} castShadow>
                <boxGeometry args={[o.r * 1.1, 0.55, o.r * 1.1]} />
                <meshStandardMaterial color="#3A2A1C" roughness={0.95} />
              </mesh>
            )}
            <Html position={[0, 0.9, 0]} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
              <div className="whitespace-nowrap rounded-[2px] bg-void/[0.85] px-1 py-[1px] font-mono text-[8px] uppercase tracking-wider text-danger">
                {o.label ?? 'OBSTACLE'}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  LOW: '#38BDF8',
  MEDIUM: '#FBBF24',
  HIGH: '#FB923C',
  CRITICAL: '#F87171',
};

export function TrafficMarkers({ snap }: { snap: Snapshot }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(id);
  }, []);
  void tick;

  return (
    <group>
      {snap.conflicts.map((c) => (
        <ConflictRing key={c.id} x={c.at.x} y={c.at.y} severity={c.severity} ttc={c.ttc} a={c.a} b={c.b} />
      ))}
      {snap.traffic.map((e) => (
        <group key={e.id} position={[tx(e.x), 0, tz(e.y)]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
            <ringGeometry args={[0.5, 0.72, 28]} />
            <meshBasicMaterial color={SEV_COLOR[e.severity]} transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {e.kind === 'CONFLICT' && (
            <Html position={[0, 0.6, 0]} center zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
              <div
                className="whitespace-nowrap rounded-[2px] border px-1.5 py-[2px] font-mono text-[9px] font-semibold tracking-wider"
                style={{
                  background: 'rgba(7,9,12,0.9)',
                  color: SEV_COLOR[e.severity],
                  borderColor: `${SEV_COLOR[e.severity]}55`,
                }}
              >
                TTC {e.ttc?.toFixed(1)}s · {e.robotIds.join('↔')}
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}

function ConflictRing({
  x,
  y,
  severity,
  ttc,
  a,
  b,
}: {
  x: number;
  y: number;
  severity: string;
  ttc: number;
  a: string;
  b: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime % 1) / 1;
    const s = 0.5 + t * 1.4;
    ref.current.scale.set(s, s, 1);
    const m = ref.current.material as THREE.MeshBasicMaterial;
    m.opacity = 0.55 * (1 - t);
  });
  const color = SEV_COLOR[severity];
  return (
    <group position={[tx(x), 0, tz(y)]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
        <ringGeometry args={[0.55, 0.68, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.071, 0]}>
        <ringGeometry args={[0.55, 0.68, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Html position={[0, 0.35, 0]} center zIndexRange={[19, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap rounded-[2px] border px-1 py-[1px] font-mono text-[8px] font-semibold tracking-wider"
          style={{ background: 'rgba(7,9,12,0.92)', color, borderColor: `${color}55` }}
        >
          {a}↔{b} · TTC {ttc.toFixed(1)}s
        </div>
      </Html>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function TaskMarkers({ snap }: { snap: Snapshot }) {
  const active = useMemo(
    () => snap.tasks.filter((t) => t.state === 'IN_PROGRESS' || t.state === 'ASSIGNED'),
    [snap.tasks],
  );
  return (
    <group>
      {active.map((t) => {
        const isPick = t.phase === 'TO_PICK' || t.phase === 'PICKING';
        const x = isPick ? t.from.x : t.to.x;
        const y = isPick ? t.from.y : t.to.y;
        return (
          <mesh key={t.id} position={[tx(x), 0.055, tz(y)]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.22, 0.3, 20]} />
            <meshBasicMaterial
              color={isPick ? '#38BDF8' : '#34D399'}
              transparent
              opacity={0.65}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
