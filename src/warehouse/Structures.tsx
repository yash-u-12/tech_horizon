/**
 * Static warehouse geometry: floor, zones, racks, conveyors, pillars, pallets,
 * charging pads and packages. Built once from the warehouse model and then
 * left alone — nothing here re-renders.
 */

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Warehouse } from '@/simulation/environment/warehouse';
import { WORLD_H, WORLD_W } from '@/simulation/environment/warehouse';
import { tx, tz } from './shared';

const RACK_BASE = '#2A3441';
const RACK_EDGE = '#3B4859';
const RACK_SHELF = '#FB923C';

export function Floor({ grid }: { grid: boolean }) {
  return (
    <group>
      {/* slab */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[WORLD_W, WORLD_H]} />
        <meshStandardMaterial color="#0B0F15" roughness={0.94} metalness={0.06} />
      </mesh>
      {/* concrete sheen */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}>
        <planeGeometry args={[WORLD_W - 1, WORLD_H - 1]} />
        <meshStandardMaterial color="#0E141B" roughness={0.88} metalness={0.1} />
      </mesh>
      {grid && (
        <gridHelper
          args={[Math.max(WORLD_W, WORLD_H), Math.max(WORLD_W, WORLD_H), '#16202B', '#111923']}
          position={[0, 0.002, 0]}
        />
      )}
    </group>
  );
}

export function Zones({ warehouse, visible, labels }: { warehouse: Warehouse; visible: boolean; labels: boolean }) {
  if (!visible) return null;
  return (
    <group>
      {warehouse.zones
        .filter((z) => z.kind !== 'AISLE')
        .map((z) => {
          const w = z.x1 - z.x0;
          const h = z.y1 - z.y0;
          const cx = tx(z.x0 + w / 2);
          const cz = tz(z.y0 + h / 2);
          const isCharge = z.kind === 'CHARGING';
          return (
            <group key={z.id} position={[cx, 0, cz]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]}>
                <planeGeometry args={[w, h]} />
                <meshBasicMaterial color={z.color} transparent opacity={isCharge ? 0.07 : 0.045} depthWrite={false} />
              </mesh>
              <lineSegments position={[0, 0.012, 0]}>
                <edgesGeometry args={[new THREE.PlaneGeometry(w, h)]} />
                <lineBasicMaterial color={z.color} transparent opacity={0.34} />
              </lineSegments>
              {labels && (
                <Html position={[0, 0.02, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
                  <div
                    className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.2em]"
                    style={{ color: z.color, opacity: 0.62, textShadow: '0 1px 3px rgba(0,0,0,.9)' }}
                  >
                    {z.name}
                  </div>
                </Html>
              )}
            </group>
          );
        })}
    </group>
  );
}

export function Structures({ warehouse }: { warehouse: Warehouse }) {
  const racks = useMemo(() => warehouse.objects.filter((o) => o.kind === 'RACK'), [warehouse]);
  const others = useMemo(() => warehouse.objects.filter((o) => o.kind !== 'RACK'), [warehouse]);

  return (
    <group>
      {/* perimeter walls */}
      {others
        .filter((o) => o.kind === 'WALL')
        .map((o) => (
          <mesh key={o.id} position={[tx(o.x), o.height / 2, tz(o.y)]} castShadow receiveShadow>
            <boxGeometry args={[o.w, o.height, o.h]} />
            <meshStandardMaterial color="#151C25" roughness={0.9} metalness={0.15} />
          </mesh>
        ))}

      {others
        .filter((o) => o.kind === 'PILLAR')
        .map((o) => (
          <mesh key={o.id} position={[tx(o.x), o.height / 2, tz(o.y)]} castShadow>
            <boxGeometry args={[o.w, o.height, o.h]} />
            <meshStandardMaterial color="#1B2430" roughness={0.7} metalness={0.4} />
          </mesh>
        ))}

      {others
        .filter((o) => o.kind === 'CONVEYOR')
        .map((o) => (
          <group key={o.id} position={[tx(o.x), 0, tz(o.y)]}>
            <mesh position={[0, o.height / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[o.w, o.height, o.h]} />
              <meshStandardMaterial color="#1E2733" roughness={0.6} metalness={0.5} />
            </mesh>
            <mesh position={[0, o.height + 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[o.w * 0.72, o.h * 0.98]} />
              <meshStandardMaterial color="#0F151D" roughness={0.35} metalness={0.6} />
            </mesh>
          </group>
        ))}

      {others
        .filter((o) => o.kind === 'PALLET')
        .map((o) => (
          <group key={o.id} position={[tx(o.x), 0, tz(o.y)]}>
            <mesh position={[0, o.height / 2, 0]} castShadow>
              <boxGeometry args={[o.w, o.height, o.h]} />
              <meshStandardMaterial color="#4A3A28" roughness={0.95} />
            </mesh>
            <mesh position={[0, o.height + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[o.w * 0.9, o.h * 0.9]} />
              <meshStandardMaterial color="#5A4632" roughness={0.95} />
            </mesh>
          </group>
        ))}

      {/* racks */}
      {racks.map((rack) => (
        <group key={rack.id} position={[tx(rack.x), 0, tz(rack.y)]}>
          <mesh position={[0, rack.height / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[rack.w, rack.height, rack.h]} />
            <meshStandardMaterial color={RACK_BASE} roughness={0.78} metalness={0.28} />
          </mesh>
          {/* frame edges */}
          <lineSegments position={[0, rack.height / 2, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(rack.w, rack.height, rack.h)]} />
            <lineBasicMaterial color={RACK_EDGE} transparent opacity={0.55} />
          </lineSegments>
          {/* shelf levels — cargo accent */}
          {[0.32, 0.58, 0.84].map((f) => (
            <mesh key={f} position={[0, rack.height * f, 0]}>
              <boxGeometry args={[rack.w + 0.04, 0.05, rack.h + 0.04]} />
              <meshStandardMaterial color={RACK_SHELF} roughness={0.7} metalness={0.2} transparent opacity={0.5} />
            </mesh>
          ))}
          {/* pick face marker on the servicing aisle side */}
          {rack.pickFace && (
            <mesh
              position={[rack.pickFace.x - rack.x, 0.02, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <planeGeometry args={[0.34, rack.h * 0.94]} />
              <meshBasicMaterial color="#38BDF8" transparent opacity={0.075} depthWrite={false} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

export function Chargers({ warehouse }: { warehouse: Warehouse }) {
  const pulse = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!pulse.current) return;
    const m = pulse.current.material as THREE.MeshBasicMaterial;
    m.opacity = 0.16 + 0.08 * Math.sin(clock.elapsedTime * 2.2);
  });
  return (
    <group>
      {warehouse.chargers.map((c) => (
        <group key={c.id} position={[tx(c.x), 0, tz(c.y)]}>
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.42, 0.56, 24]} />
            <meshBasicMaterial color="#34D399" transparent opacity={0.5} side={THREE.DoubleSide} />
          </mesh>
          <mesh ref={pulse} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.42, 24]} />
            <meshBasicMaterial color="#34D399" transparent opacity={0.18} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[0.16, 1.1, 0.16]} />
            <meshStandardMaterial color="#1E2733" roughness={0.6} metalness={0.5} />
          </mesh>
          <mesh position={[0, 1.14, 0]}>
            <boxGeometry args={[0.34, 0.2, 0.24]} />
            <meshStandardMaterial
              color="#34D399"
              emissive="#34D399"
              emissiveIntensity={c.occupiedBy ? 0.9 : 0.28}
              roughness={0.4}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Packages({ warehouse, visible }: { warehouse: Warehouse; visible: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const stored = useMemo(() => warehouse.packages.filter((p) => p.state === 'STORED'), [warehouse.packages.length]);

  useFrame(() => {
    if (!ref.current || !visible) return;
    let i = 0;
    for (const p of stored) {
      if (p.x == null || p.y == null) continue;
      dummy.position.set(tx(p.x), 0.45, tz(p.y));
      dummy.scale.set(0.26, 0.26, 0.26);
      dummy.rotation.set(0, (p.x * 13 + p.y * 7) % Math.PI, 0);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
      i++;
    }
    ref.current.count = i;
    ref.current.instanceMatrix.needsUpdate = true;
  });

  if (!visible) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, stored.length)]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#8A6A44" roughness={0.92} />
    </instancedMesh>
  );
}

export function Lighting() {
  return (
    <group>
      <ambientLight intensity={0.55} color="#7C8FA6" />
      <hemisphereLight args={['#3A4A5E', '#0A0E14', 0.6]} />
      <directionalLight
        position={[14, 26, 10]}
        intensity={1.05}
        color="#CFE0F2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.0008}
      />
      <directionalLight position={[-18, 14, -12]} intensity={0.32} color="#5C7A9E" />
      {/* two cold working lights over the storage block */}
      <pointLight position={[tx(21), 7, tz(17)]} intensity={22} distance={26} decay={2} color="#8FB6D8" />
      <pointLight position={[tx(21), 7, tz(26)]} intensity={14} distance={22} decay={2} color="#8FB6D8" />
    </group>
  );
}
