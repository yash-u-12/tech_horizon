import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, MapControls, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { C, labelTexture, makeLine, makeTrail, rectOutlinePoints, statusColor, modeColor } from './sceneUtils'
import { useNexus, type AgentView, type Snapshot } from '../../store/useNexus'
import { WORLD } from '../../simulation/config'

/* =========================================================================
 * THE 3D WAREHOUSE — the hero of NEXUS.
 *
 * Everything on screen is driven by simulation state: robot poses come from
 * execution backends, paths from the agents' own planners, the physical bodies
 * from gateway telemetry. Nothing here animates on its own.
 * ========================================================================= */

/* ------------------------------------------------------------------- lights */

function Lights() {
  return (
    <>
      <ambientLight intensity={0.42} color="#8ea3bd" />
      <hemisphereLight args={['#1d2b3d', '#05070a', 0.55]} />
      <directionalLight
        position={[18, 26, 12]}
        intensity={1.05}
        color="#e8f0ff"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-far={80}
        shadow-bias={-0.0006}
      />
      <directionalLight position={[-22, 14, -16]} intensity={0.28} color="#4a6d92" />
      <pointLight position={[-27, 4, 13]} intensity={12} distance={16} color="#4b8ef7" />
      <pointLight position={[24, 4, 13]} intensity={12} distance={16} color="#3fce8b" />
    </>
  )
}

/* -------------------------------------------------------------------- floor */

type Overlays = ReturnType<typeof useNexus.getState>['overlays']

function Floor({ overlays }: { overlays: Overlays }) {
  const snap = useNexus((s) => s.snapshot)
  const zones = snap.zones
  const zoneGeo = useMemo(
    () => zones.map((z) => ({ color: new THREE.Color(z.color), points: rectOutlinePoints(z.rect.x, z.rect.z, z.rect.w, z.rect.d) })),
    [zones],
  )
  const zoneMeshes = useMemo(
    () =>
      zoneGeo.map((z, i) => ({
        outline: makeLine(z.points, '#' + z.color.getHexString(), { y: 0.02, opacity: 0.5 }),
        index: i,
      })),
    [zoneGeo],
  )
  return (
    <group>
      {/* concrete floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[WORLD.width, WORLD.depth]} />
        <meshStandardMaterial color={C.floor} roughness={0.94} metalness={0.06} />
      </mesh>
      {/* floor apron so the world does not float in the void */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[WORLD.width + 26, WORLD.depth + 26]} />
        <meshStandardMaterial color="#05070a" roughness={1} />
      </mesh>
      {overlays.grid && (
        <Grid
          args={[WORLD.width, WORLD.depth]}
          position={[0, 0.012, 0]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#16202c"
          sectionSize={5}
          sectionThickness={0.9}
          sectionColor="#22303f"
          fadeDistance={95}
          fadeStrength={1.4}
          followCamera={false}
          infiniteGrid={false}
        />
      )}
      {overlays.zones &&
        zoneMeshes.map((z) => (
          <primitive key={z.index} object={z.outline} />
        ))}
      {overlays.zones &&
        zones.map((z, i) => (
          <mesh key={z.id} rotation={[-Math.PI / 2, 0, 0]} position={[z.rect.x, 0.015, z.rect.z]}>
            <planeGeometry args={[z.rect.w, z.rect.d]} />
            <meshBasicMaterial color={z.color} transparent opacity={0.055} depthWrite={false} />
          </mesh>
        ))}
    </group>
  )
}

/* --------------------------------------------------------------- structures */

function Structures() {
  const snap = useNexus((s) => s.snapshot)
  const selectedTask = useNexus((s) => s.selectedTaskId)
  const racks = snap.objects.filter((o) => o.kind === 'RACK')
  const stations = snap.objects.filter((o) => o.kind === 'STATION' || o.kind === 'CHARGE_STATION')
  const conveyors = snap.objects.filter((o) => o.kind === 'CONVEYOR')

  const packages = useMemo(() => {
    const list: { x: number; z: number; y: number; w: number }[] = []
    for (const r of racks) {
      r.packages.forEach((id, i) => {
        const pkg = snap.packages.find((p) => p.id === id)
        list.push({
          x: r.rect.x + (i % 3 - 1) * (r.rect.w / 3.4),
          z: r.rect.z + (Math.floor(i / 3) - 0.5) * (r.rect.d / 2.6),
          y: 0.24,
          w: pkg ? Math.max(0.35, Math.min(0.72, pkg.weightKg * 0.11)) : 0.42,
        })
      })
    }
    for (const s of stations) {
      s.packages.forEach((id, i) => {
        const pkg = snap.packages.find((p) => p.id === id)
        list.push({ x: s.rect.x + (i % 4 - 1.5) * 0.4, z: s.rect.z + (i > 3 ? 0.4 : 0), y: 0.96, w: pkg ? Math.max(0.35, Math.min(0.72, pkg.weightKg * 0.11)) : 0.42 })
      })
    }
    return list
  }, [racks, stations, snap.packages])

  // the highlighted task's pick/drop targets glow amber
  const taskTargets = useMemo(() => {
    const t = snap.tasks.find((x) => x.id === selectedTask)
    if (!t) return []
    return t.steps.map((s) => ({ id: s.targetId, pose: s.pose, kind: s.kind, done: s.status === 'DONE' }))
  }, [snap.tasks, selectedTask])

  // racks stand on legs so the drive-under aisle stays readable and the AMRs
  // passing beneath are never hidden by shelving
  const LIFT = 0.78

  return (
    <group>
      {racks.map((r) => {
        const pkgCount = r.packages.length
        const heat = pkgCount / 4
        return (
          <group key={r.id} position={[r.rect.x, 0, r.rect.z]}>
            {/* uprights */}
            {[-1, 1].map((sx) =>
              [-1, 1].map((sz) => (
                <mesh key={`${sx}${sz}`} position={[sx * (r.rect.w / 2 - 0.1), LIFT + r.height / 2, sz * (r.rect.d / 2 - 0.1)]} castShadow receiveShadow>
                  <boxGeometry args={[0.12, r.height, 0.12]} />
                  <meshStandardMaterial color={C.rackEdge} roughness={0.5} metalness={0.55} />
                </mesh>
              )),
            )}
            {/* legs (0 → deck) so robots are visible underneath */}
            {[-1, 1].map((sx) =>
              [-1, 1].map((sz) => (
                <mesh key={`leg${sx}${sz}`} position={[sx * (r.rect.w / 2 - 0.1), LIFT / 2, sz * (r.rect.d / 2 - 0.1)]} castShadow>
                  <boxGeometry args={[0.16, LIFT, 0.16]} />
                  <meshStandardMaterial color="#3f3225" roughness={0.6} metalness={0.4} />
                </mesh>
              )),
            )}
            {/* shelf deck */}
            <mesh position={[0, LIFT + r.height * 0.52, 0]} castShadow receiveShadow>
              <boxGeometry args={[r.rect.w, 0.1, r.rect.d]} />
              <meshStandardMaterial color={C.rack} roughness={0.78} metalness={0.18} />
            </mesh>
            {/* cargo block, tinted by load factor */}
            <mesh position={[0, LIFT + 0.24, 0]}>
              <boxGeometry args={[r.rect.w - 0.2, 0.46, r.rect.d - 0.2]} />
              <meshStandardMaterial color={new THREE.Color(C.package).lerp(new THREE.Color('#5a4a33'), 1 - heat)} roughness={0.85} />
            </mesh>
            <mesh position={[0, LIFT + r.height, 0]} castShadow>
              <boxGeometry args={[r.rect.w + 0.16, 0.12, r.rect.d + 0.16]} />
              <meshStandardMaterial color={C.rackTop} roughness={0.7} metalness={0.25} />
            </mesh>
            {/* pick-face marking */}
            {r.pickFace && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[r.pickFace.x - r.rect.x, 0.021, r.pickFace.z - r.rect.z]}>
                <planeGeometry args={[1.5, 0.5]} />
                <meshBasicMaterial color={C.sim} transparent opacity={0.14} depthWrite={false} />
              </mesh>
            )}
          </group>
        )
      })}

      {stations.map((s) => (
        <group key={s.id} position={[s.rect.x, 0, s.rect.z]}>
          <mesh position={[0, s.height / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[s.rect.w, s.height, s.rect.d]} />
            <meshStandardMaterial
              color={s.kind === 'CHARGE_STATION' ? '#1f4a44' : C.station}
              roughness={0.6}
              metalness={0.45}
            />
          </mesh>
          <mesh position={[0, s.height + 0.02, 0]}>
            <boxGeometry args={[s.rect.w * 0.86, 0.05, s.rect.d * 0.86]} />
            <meshStandardMaterial
              color={s.kind === 'CHARGE_STATION' ? C.green : C.sim}
              emissive={s.kind === 'CHARGE_STATION' ? C.green : C.sim}
              emissiveIntensity={0.35}
              roughness={0.4}
            />
          </mesh>
        </group>
      ))}

      {conveyors.map((c) => (
        <mesh key={c.id} position={[c.rect.x, c.height / 2, c.rect.z]} castShadow receiveShadow>
          <boxGeometry args={[c.rect.w, c.height, c.rect.d]} />
          <meshStandardMaterial color={C.conveyor} roughness={0.55} metalness={0.5} />
        </mesh>
      ))}

      {packages.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]} castShadow>
          <boxGeometry args={[p.w, p.w * 0.7, p.w]} />
          <meshStandardMaterial color={C.package} roughness={0.9} />
        </mesh>
      ))}

      {taskTargets.map((t) => (
        <group key={t.id + t.kind} position={[t.pose.x, 0, t.pose.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.028, 0]}>
            <ringGeometry args={[0.75, 0.95, 40]} />
            <meshBasicMaterial color={t.done ? C.green : C.amber} transparent opacity={t.done ? 0.35 : 0.85} depthWrite={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.027, 0]}>
            <ringGeometry args={[0.3, 0.42, 32]} />
            <meshBasicMaterial color={t.done ? C.green : C.amber} transparent opacity={0.6} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* -------------------------------------------------------------- obstacles */

function Obstacles() {
  const snap = useNexus((s) => s.snapshot)
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.elapsedTime
    ref.current.children.forEach((c, i) => {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (m) m.emissiveIntensity = 0.18 + Math.sin(t * 2 + i) * 0.1
    })
  })
  return (
    <group ref={ref}>
      {snap.obstacles.map((o) => (
        <group key={o.id} position={[o.rect.x, 0, o.rect.z]}>
          <mesh position={[0, 0.28, 0]} castShadow>
            <boxGeometry args={[o.rect.w, 0.56, o.rect.d]} />
            <meshStandardMaterial color={C.obstacle} emissive={C.obstacle} emissiveIntensity={0.2} roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
            <ringGeometry args={[Math.max(o.rect.w, o.rect.d) * 0.62, Math.max(o.rect.w, o.rect.d) * 0.72, 36]} />
            <meshBasicMaterial color={C.red} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ robots */

function AMRBody({
  color,
  selected,
  ghost,
  physical,
}: {
  color: string
  selected: boolean
  ghost?: boolean
  physical?: boolean
}) {
  return (
    <group>
      {/* chassis */}
      <RoundedBox args={[0.82, 0.19, 0.72]} radius={0.055} smoothness={3} position={[0, 0.13, 0]} castShadow>
        <meshStandardMaterial color={color} transparent={ghost} opacity={ghost ? 0.3 : 1} roughness={0.42} metalness={0.55} depthWrite={!ghost} />
      </RoundedBox>
      {/* deck */}
      <mesh position={[0, 0.245, 0]} castShadow>
        <boxGeometry args={[0.66, 0.045, 0.56]} />
        <meshStandardMaterial color="#20262e" transparent={ghost} opacity={ghost ? 0.25 : 1} roughness={0.6} metalness={0.35} depthWrite={!ghost} />
      </mesh>
      {/* side skins */}
      <mesh position={[0, 0.145, 0]}>
        <boxGeometry args={[0.84, 0.06, 0.74]} />
        <meshStandardMaterial color="#0e1319" transparent={ghost} opacity={ghost ? 0.25 : 1} roughness={0.7} />
      </mesh>
      {/* cargo bay */}
      <mesh position={[0, 0.31, -0.02]} castShadow>
        <boxGeometry args={[0.52, 0.1, 0.44]} />
        <meshStandardMaterial color="#171c23" transparent={ghost} opacity={ghost ? 0.2 : 1} roughness={0.8} />
      </mesh>
      {/* sensor mast */}
      <mesh position={[0, 0.42, 0.22]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.3, 10]} />
        <meshStandardMaterial color="#2b3340" transparent={ghost} opacity={ghost ? 0.3 : 1} roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0.64, 0.16]}>
        <sphereGeometry args={[0.085, 14, 12]} />
        <meshStandardMaterial color={physical ? C.real : C.sim} emissive={physical ? C.real : C.sim} emissiveIntensity={ghost ? 0.1 : 0.5} transparent={ghost} opacity={ghost ? 0.25 : 1} />
      </mesh>
      {/* forward chevron */}
      <mesh position={[0.42, 0.155, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[0.1, 0.15, 3]} />
        <meshStandardMaterial color={physical ? C.real : C.sim} emissive={physical ? C.real : C.sim} emissiveIntensity={selected ? 0.5 : 0.22} transparent={ghost} opacity={ghost ? 0.25 : 1} />
      </mesh>
      {/* wheels */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.055, s * 0.33]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.06, 12]} />
          <meshStandardMaterial color="#0a0d11" roughness={0.9} transparent={ghost} opacity={ghost ? 0.25 : 1} />
        </mesh>
      ))}
    </group>
  )
}

function RobotLabel({ agent, dim }: { agent: AgentView; dim: boolean }) {
  const tex = useMemo(() => {
    const mode = agent.hardwareId ? (agent.executionMode === 'PHYSICAL' ? 'REAL' : 'MOCK') : 'SIM'
    return labelTexture(`${agent.id}  ${mode}`, {
      size: 26,
      weight: 600,
      mono: true,
      color: dim ? '#8494a8' : '#e8eef8',
      bg: 'rgba(8,11,16,0.72)',
      border: agent.hardwareId ? C.real : C.sim,
    })
  }, [agent.id, agent.hardwareId, agent.executionMode, dim])
  const aspect = (tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height
  const h = 0.3
  return (
    <sprite position={[0, 1.05, 0]} scale={[h * aspect, h, 1]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthTest={true} depthWrite={false} />
    </sprite>
  )
}

function RobotMesh({ agent }: { agent: AgentView }) {
  const selected = useNexus((s) => s.selectedAgentId === agent.id)
  const selectAgent = useNexus((s) => s.selectAgent)
  const overlays = useNexus((s) => s.overlays)
  const group = useRef<THREE.Group>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const physical = !!agent.hardwareId
  const color = statusColor(agent.status, agent.fault)

  // smooth interpolation between snapshots so 14 Hz data looks continuous
  const target = useMemo(() => ({ x: agent.pose.x, z: agent.pose.z, theta: agent.pose.theta }), [agent.pose.x, agent.pose.z, agent.pose.theta])
  useFrame((_, dt) => {
    if (!group.current) return
    const g = group.current
    g.position.x += (target.x - g.position.x) * Math.min(1, dt * 9)
    g.position.z += (target.z - g.position.z) * Math.min(1, dt * 9)
    let dTheta = target.theta - g.rotation.y
    while (dTheta > Math.PI) dTheta -= Math.PI * 2
    while (dTheta < -Math.PI) dTheta += Math.PI * 2
    g.rotation.y += dTheta * Math.min(1, dt * 9)
    if (ringRef.current) {
      const m = ringRef.current.material as THREE.MeshBasicMaterial
      m.opacity = selected ? 0.85 : physical ? 0.42 : 0.26
    }
  })

  return (
    <>
      <group
        ref={group}
        position={[agent.pose.x, 0, agent.pose.z]}
        rotation={[0, agent.pose.theta, 0]}
        onClick={(e) => {
          e.stopPropagation()
          selectAgent(agent.id)
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'default')}
      >
        <AMRBody color={physical ? '#3a4450' : '#2c3946'} selected={selected} physical={physical} />
        {/* generous invisible hit volume — clicking a robot should be easy */}
        <mesh position={[0, 0.32, 0]} visible={false}>
          <cylinderGeometry args={[0.85, 0.85, 1.1, 8]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
        {overlays.labels && <RobotLabel agent={agent} dim={!selected} />}
        {/* ground status ring */}
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]}>
          <ringGeometry args={[0.58, 0.72, 44]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
        </mesh>
        {/* heading wedge */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.62, 0.025, 0]}>
          <circleGeometry args={[0.14, 3, -Math.PI / 2]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
        </mesh>
        {/* obstacle/defect marker */}
        {agent.fault && (
          <mesh position={[0, 0.9, 0]}>
            <octahedronGeometry args={[0.16]} />
            <meshStandardMaterial color={C.red} emissive={C.red} emissiveIntensity={0.7} />
          </mesh>
        )}
        {/* digital twin ghost: where the planner thinks the body should be */}
        {physical && overlays.trails && (
          <group position={[agent.plannedPose.x - agent.pose.x, 0, agent.plannedPose.z - agent.pose.z]} rotation={[0, agent.plannedPose.theta - agent.pose.theta, 0]}>
            <AMRBody color={C.real} selected={false} ghost physical />
          </group>
        )}
      </group>
    </>
  )
}

/* --------------------------------------------------------------- overlays */

function PathOverlay({ agent }: { agent: AgentView }) {
  const color =
    agent.pathOrigin === 'REPLAN_OBSTACLE'
      ? C.red
      : agent.pathOrigin === 'REPLAN_TRAFFIC'
        ? C.purple
        : agent.pathOrigin === 'REPLAN_TASK'
          ? C.blue
          : C.sim
  const obj = useMemo(() => {
    if (agent.pathPoints.length < 2) return null
    return makeLine(agent.pathPoints, color, { y: 0.045, opacity: 0.85 })
  }, [agent.pathPoints, color])
  const trail = useMemo(() => {
    if (agent.actualTrail.length < 2) return null
    return makeTrail(agent.actualTrail, C.green, 0.032)
  }, [agent.actualTrail])
  const goal = agent.goal
  if (!obj && !trail) return null
  return (
    <group>
      {obj && <primitive object={obj} />}
      {trail && <primitive object={trail} />}
      {goal && (
        <group position={[goal.x, 0, goal.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[0.36, 0.48, 32]} />
            <meshBasicMaterial color={color} transparent opacity={0.75} depthWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  )
}

function PerceptionOverlay({ agent }: { agent: AgentView }) {
  const radius = agent.perceptionRadius
  const ctx = agent.context
  const ring = useMemo(() => {
    const g = new THREE.RingGeometry(radius - 0.06, radius, 96)
    const m = new THREE.MeshBasicMaterial({ color: C.sim, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
    return new THREE.Mesh(g, m)
  }, [radius])
  const lidar = useMemo(() => {
    const engine = useNexus.getState().engine
    const a = engine.agents.get(agent.id)
    if (!a) return []
    const pts: number[] = []
    const grid = engine.grid
    for (let i = 0; i < 72; i++) {
      const ang = (i / 72) * Math.PI * 2
      let r = 0.5
      for (; r <= radius; r += 0.3) {
        if (grid.blockedAt(a.pose.x + Math.cos(ang) * r, a.pose.z + Math.sin(ang) * r)) break
      }
      pts.push(a.pose.x + Math.cos(ang) * Math.min(r, radius), 0.09, a.pose.z + Math.sin(ang) * Math.min(r, radius))
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return geom
  }, [agent.id, radius])

  return (
    <group position={[agent.pose.x, 0, agent.pose.z]}>
      <primitive object={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.024, 0]} />
      {lidar instanceof THREE.BufferGeometry && (
        <points geometry={lidar}>
          <pointsMaterial color={C.sim} size={0.11} transparent opacity={0.85} sizeAttenuation depthWrite={false} />
        </points>
      )}
      {ctx?.peers.map((p) => {
        const engine = useNexus.getState().engine
        const peer = engine.agents.get(p.id)
        if (!peer) return null
        const conflict = p.ttc !== null && p.ttc < 3
        const mat = new THREE.LineBasicMaterial({ color: conflict ? C.red : C.amber, transparent: true, opacity: conflict ? 0.85 : 0.5 })
        const geom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(agent.pose.x, 0.08, agent.pose.z),
          new THREE.Vector3(peer.pose.x, 0.08, peer.pose.z),
        ])
        return <primitive key={p.id} object={new THREE.Line(geom, mat)} />
      })}
    </group>
  )
}

function TrafficOverlay() {
  const snap = useNexus((s) => s.snapshot)
  const risks = snap.collisionRisks
  const objects = useMemo(
    () =>
      risks.slice(0, 8).map((r) => {
        const a = snap.agents.find((x) => x.id === r.a)
        const b = snap.agents.find((x) => x.id === r.b)
        if (!a || !b) return null
        const conflict = (r.ttc !== null && r.ttc < 3) || r.distance < 1.35
        const geom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a.pose.x, 0.06, a.pose.z),
          new THREE.Vector3(b.pose.x, 0.06, b.pose.z),
        ])
        const color = r.severity > 0.7 ? C.red : r.severity > 0.4 ? C.amber : C.dim
        const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: conflict ? 0.95 : 0.45 })
        const line = new THREE.Line(geom, mat)
        line.computeLineDistances()
        return { line, key: `${r.a}${r.b}`, mid: { x: (a.pose.x + b.pose.x) / 2, z: (a.pose.z + b.pose.z) / 2 }, ttc: r.ttc, conflict }
      }),
    [risks, snap.agents],
  )
  return (
    <group>
      {objects.map(
        (o) =>
          o && (
            <group key={o.key}>
              <primitive object={o.line} />
              {o.conflict && (
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[o.mid.x, 0.03, o.mid.z]}>
                  <ringGeometry args={[0.9, 1.05, 40]} />
                  <meshBasicMaterial color={o.ttc !== null && o.ttc < 1.6 ? C.red : C.amber} transparent opacity={0.6} depthWrite={false} />
                </mesh>
              )}
            </group>
          ),
      )}
    </group>
  )
}

function DensityOverlay() {
  const engine = useNexus.getState().engine
  const cells = useMemo(() => {
    const res: { x: number; z: number; v: number }[] = []
    for (let x = -WORLD.width / 2 + 3; x < WORLD.width / 2; x += 3) {
      for (let z = -WORLD.depth / 2 + 3; z < WORLD.depth / 2; z += 3) {
        let density = 0
        for (const a of engine.agents.values()) {
          const d = Math.hypot(a.pose.x - x, a.pose.z - z)
          density += Math.max(0, 1 - d / 9)
        }
        for (const resv of engine.peerReservations()) {
          for (const c of resv.cells) {
            const d = Math.hypot(c.x - x, c.z - z)
            density += Math.max(0, 1 - d / 5) * 0.8
          }
        }
        if (density > 0.05) res.push({ x, z, v: Math.min(1, density) })
      }
    }
    return res
  }, [engine])
  return (
    <group>
      {cells.map((c, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[c.x, 0.018, c.z]}>
          <planeGeometry args={[3, 3]} />
          <meshBasicMaterial color={new THREE.Color(C.green).lerp(new THREE.Color(C.red), c.v)} transparent opacity={0.06 + c.v * 0.2} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function HardwareBeing({ hw }: { hw: Snapshot['hardware'][number] }) {
  const selectHardware = useNexus((s) => s.selectHardware)
  const selected = useNexus((s) => s.selectedHardwareId === hw.id)
  const bound = !!hw.boundAgentId
  const color = hw.status === 'OFFLINE' ? '#4a5563' : hw.status === 'ERROR' ? C.red : C.real
  return (
    <group
      position={[hw.position.x, 0, hw.position.z]}
      rotation={[0, hw.position.theta, 0]}
      onClick={(e) => {
        e.stopPropagation()
        selectHardware(hw.id)
      }}
    >
      <group position={[0, 0, 0]}>
        <RoundedBox args={[0.9, 0.2, 0.78]} radius={0.05} smoothness={2} position={[0, 0.14, 0]} castShadow>
          <meshStandardMaterial color={bound ? '#43382c' : '#252c35'} roughness={0.5} metalness={0.5} />
        </RoundedBox>
        <mesh position={[0, 0.31, 0]}>
          <boxGeometry args={[0.6, 0.14, 0.5]} />
          <meshStandardMaterial color="#1b3a3d" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.2, 0.4]}>
          <boxGeometry args={[0.5, 0.05, 0.03]} />
          <meshBasicMaterial color={color} transparent opacity={selected ? 0.95 : 0.5} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]}>
          <ringGeometry args={[0.66, 0.8, 40]} />
          <meshBasicMaterial color={bound ? C.real : C.dim} transparent opacity={bound ? 0.5 : 0.25} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ camera */

function CameraRig() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3; update?: () => void } | null
  const mode = useNexus((s) => s.cameraMode)
  const followId = useNexus((s) => s.followAgentId)
  const snap = useNexus((s) => s.snapshot)
  const mounted = useRef(false)
  const prevMode = useRef(mode)

  useMemo(() => {
    // jump to the requested framing
    if (mode === 'TOP') {
      camera.position.set(0, 84, 0.001)
    } else if (mode === 'ISO') {
      camera.position.set(44, 40, 44)
    } else if (mode === 'ORBIT') {
      camera.position.set(42, 33, 46)
    }
    if (controls?.target) controls.target.set(0, 0, -3)
    controls?.update?.()
    mounted.current = true
  }, [mode, camera, controls])

  useFrame(() => {
    if (mode !== 'FOLLOW' || !followId) return
    const a = snap.agents.find((x) => x.id === followId)
    if (!a || !controls?.target) return
    const t = controls.target
    t.x += (a.pose.x - t.x) * 0.12
    t.z += (a.pose.z - t.z) * 0.12
    const desiredX = a.pose.x + Math.cos(a.pose.theta) * 9
    const desiredZ = a.pose.z + Math.sin(a.pose.theta) * 9
    camera.position.x += (desiredX - camera.position.x) * 0.05
    camera.position.z += (desiredZ - camera.position.z) * 0.05
    camera.position.y += (11 - camera.position.y) * 0.05
    controls.update?.()
    void prevMode
  })
  return null
}

/* ------------------------------------------------------------------ canvas */

export function WarehouseCanvas() {
  const overlays = useNexus((s) => s.overlays)
  const agents = useNexus((s) => s.snapshot.agents)
  const hardware = useNexus((s) => s.snapshot.hardware)
  const selectedAgentId = useNexus((s) => s.selectedAgentId)
  const selectAgent = useNexus((s) => s.selectAgent)
  const selected = agents.find((a) => a.id === selectedAgentId)

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [42, 33, 46], fov: 42, near: 0.5, far: 400 }}
      onPointerMissed={() => selectAgent(null)}
      style={{ background: 'linear-gradient(180deg,#060910 0%,#04060a 100%)' }}
    >
      <color attach="background" args={['#05070b']} />
      <fogExp2 attach="fog" args={['#05070b', 0.0145]} />
      <Suspense fallback={null}>
        <Lights />
        <Floor overlays={overlays} />
        <Structures />
        <Obstacles />
        {hardware.map((h) => (
          <HardwareBeing key={h.id} hw={h} />
        ))}
        {agents.map((a) => (
          <RobotMesh key={a.id} agent={a} />
        ))}
        {overlays.paths && agents.map((a) => <PathOverlay key={a.id} agent={a} />)}
        {overlays.traffic && <TrafficOverlay />}
        {overlays.density && <DensityOverlay />}
        {overlays.perception && selected && <PerceptionOverlay agent={selected} />}
        {overlays.perception &&
          agents
            .filter((a) => a.id !== selectedAgentId)
            .map((a) => (
              <mesh key={a.id} rotation={[-Math.PI / 2, 0, 0]} position={[a.pose.x, 0.022, a.pose.z]}>
                <ringGeometry args={[a.perceptionRadius - 0.04, a.perceptionRadius, 64]} />
                <meshBasicMaterial color={modeColor(a.executionMode)} transparent opacity={0.055} depthWrite={false} />
              </mesh>
            ))}
        <CameraRig />
        <MapControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={Math.PI / 2.15}
          minDistance={6}
          maxDistance={150}
          screenSpacePanning={false}
          panSpeed={1.1}
          zoomSpeed={1.15}
        />
      </Suspense>
    </Canvas>
  )
}
