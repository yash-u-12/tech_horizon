/**
 * The 3D warehouse — the hero surface of NEXUS.
 *
 * Everything here is a VIEW of the live simulation. Positions, plans, perception
 * and traffic are read from the engine every frame; nothing is animated
 * independently of the simulation state.
 */

import { Suspense, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { AdaptiveDpr, Html } from '@react-three/drei';
import { runtime } from '@/simulation/runtime';
import { useNexus } from '@/store/useNexus';
import { Structures, Floor, Zones, Chargers, Packages, Lighting } from './Structures';
import { RobotUnit } from './RobotUnit';
import { RobotPaths, DestinationMarker } from './Paths';
import { PerceptionOverlay, Obstacles, TrafficMarkers, TaskMarkers } from './Overlays';
import { CameraRig } from './CameraRig';
import { tx, tz } from './shared';
import { WORLD_H, WORLD_W } from '@/simulation/environment/warehouse';

function GroundPicker() {
  const { clickMode, placeFrom, setPlaceFrom } = useNexus();
  const { raycaster, camera, gl } = useThree();
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  if (clickMode === 'SELECT' && !placeFrom) return null;

  const toWorld = (e: any) => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x + WORLD_W / 2, y: hit.z + WORLD_H / 2 };
  };

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.001, 0]}
        onPointerMove={(e) => setHover(toWorld(e))}
        onPointerOut={() => setHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          const w = toWorld(e);
          if (!w) return;
          const eng = runtime.engine;
          if (clickMode === 'PLACE_OBSTACLE') {
            eng.placeObstacle(w.x, w.y, 0.9);
            useNexus.getState().notify(`OBSTACLE PLACED AT ${w.x.toFixed(1)}, ${w.y.toFixed(1)}`, 'WARNING');
            useNexus.getState().setClickMode('SELECT');
          } else if (clickMode === 'PLACE_TASK') {
            const location = eng.normalizeManualLocation(w);
            if (!location) {
              useNexus.getState().notify('Choose a clear warehouse cell outside shelves and obstacles.', 'WARNING');
              return;
            }
            if (!placeFrom) {
              setPlaceFrom(location);
              useNexus.getState().notify('PICK LOCATION SET · NOW SELECT A DESTINATION', 'INFO');
            } else {
              const result = eng.createManualOrder(placeFrom, location);
              if (!result.task) {
                useNexus.getState().notify(result.error ?? 'The order could not be created.', 'WARNING');
                return;
              }
              runtime.emit();
              useNexus.getState().setClickMode('SELECT');
              useNexus.getState().notify(`${result.task.id} CONFIRMED · CRITICAL PRIORITY · ALLOCATION STARTED`, 'SUCCESS');
            }
          }
        }}
      >
        <planeGeometry args={[WORLD_W, WORLD_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {hover && (
        <group position={[tx(hover.x), 0.08, tz(hover.y)]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.7, 0.9, 24]} />
            <meshBasicMaterial color="#38BDF8" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      )}
      {hover && placeFrom && <Line2D a={placeFrom} b={hover} />}
      {placeFrom && (
        <group position={[tx(placeFrom.x), 0.08, tz(placeFrom.y)]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.3, 20]} />
            <meshBasicMaterial color="#34D399" transparent opacity={0.8} depthWrite={false} />
          </mesh>
          <Html center position={[0, 0.6, 0]} style={{ pointerEvents: 'none' }}>
            <div className="whitespace-nowrap rounded-[2px] bg-void/90 px-1 py-[1px] font-mono text-[8px] uppercase tracking-wider text-ok">
              PICK
            </div>
          </Html>
        </group>
      )}
    </>
  );
}

function Line2D({ a, b }: { a: { x: number; y: number }; b: { x: number; y: number } }) {
  const obj = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(tx(a.x), 0.05, tz(a.y)),
      new THREE.Vector3(tx(b.x), 0.05, tz(b.y)),
    ]);
    const m = new THREE.LineBasicMaterial({ color: '#38BDF8', transparent: true, opacity: 0.7 });
    return new THREE.Line(g, m);
  }, [a.x, a.y, b.x, b.y]);
  return <primitive object={obj} />;
}

function WarehouseContents() {
  const snap = useNexus((s) => s.snap);
  const layers = useNexus((s) => s.layers);
  const selectedRobot = useNexus((s) => s.selectedRobot);
  const hoveredRobot = useNexus((s) => s.hoveredRobot);
  const selectRobot = useNexus((s) => s.selectRobot);
  const hoverRobot = useNexus((s) => s.hoverRobot);
  const followId = useNexus((s) => s.followId);
  const cameraMode = useNexus((s) => s.cameraMode);
  const cameraGesture = useNexus((s) => s.cameraGesture);
  const cameraPinchZoom = useNexus((s) => s.cameraPinchZoom);

  const engine = runtime.engine;
  const warehouse = engine.warehouse;
  const showPaths = useNexus((s) => s.layers.paths);

  const followPose = useMemo(() => {
    const a = engine.agents.find((x) => x.state.id === followId);
    return a ? { x: a.state.pose.x, y: a.state.pose.y } : null;
  }, [followId, snap.tick]);

  const selectedAgent = engine.agents.find((a) => a.state.id === selectedRobot) ?? null;

  return (
    <>
      <color attach="background" args={['#07090C']} />
      <fog attach="fog" args={['#07090C', 58, 132]} />
      <Lighting />
      <Floor grid={layers.grid} />
      <Zones warehouse={warehouse} visible={layers.zones} labels={layers.labels} />
      <Structures warehouse={warehouse} />
      <Chargers warehouse={warehouse} />
      <Packages warehouse={warehouse} visible={layers.packages} />
      <Obstacles obstacles={snap.obstacles} />
      <TaskMarkers snap={snap} />
      {layers.traffic && <TrafficMarkers snap={snap} />}
      <GroundPicker />

      {engine.agents.map((a) => (showPaths || a.state.id === followId) && (
        <RobotPaths
          key={`p-${a.state.id}`}
          state={a.state}
          showTrail={layers.trails}
          highlighted={a.state.id === followId}
        />
      ))}

      {engine.agents.map((a) => (
        <RobotUnit
          key={a.state.id}
          state={a.state}
          selected={selectedRobot === a.state.id}
          hovered={hoveredRobot === a.state.id}
          showLabel={layers.labels}
          onSelect={selectRobot}
          onHover={hoverRobot}
        />
      ))}

      {selectedAgent && <DestinationMarker state={selectedAgent.state} />}
      {layers.perception && (
        <PerceptionOverlay agent={selectedAgent} showOccupancy={layers.occupancy} showLinks />
      )}

      <CameraRig mode={cameraMode} gesture={cameraGesture} pinchZoom={cameraPinchZoom} followPose={followPose} resetKey={0} />
      <AdaptiveDpr pixelated />
    </>
  );
}

export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [26, 30, 34], fov: 40, near: 0.5, far: 400 }}
      onPointerMissed={() => {
        if (useNexus.getState().clickMode === 'SELECT') useNexus.getState().selectRobot(null);
      }}
    >
      <Suspense fallback={null}>
        <WarehouseContents />
      </Suspense>
    </Canvas>
  );
}
