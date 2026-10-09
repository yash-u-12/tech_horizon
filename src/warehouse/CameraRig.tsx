import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { tx, tz } from './shared';
import type { CameraMode } from '@/store/useNexus';

interface Props {
  mode: CameraMode;
  followPose: { x: number; y: number } | null;
  resetKey: number;
}

const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  ORBIT: { pos: [26, 30, 34], target: [0, 0, 0] },
  TOP: { pos: [0, 62, 0.01], target: [0, 0, 0] },
  ISO: { pos: [34, 24, -34], target: [0, 0, 0] },
};

export function CameraRig({ mode, followPose, resetKey }: Props) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3());
  const desiredTarget = useRef(new THREE.Vector3());
  const animating = useRef(true);
  const lastMode = useRef<CameraMode | null>(null);

  useEffect(() => {
    animating.current = true;
    lastMode.current = null;
  }, [resetKey]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;

    if (mode === 'FOLLOW' && followPose) {
      const px = tx(followPose.x);
      const pz = tz(followPose.y);
      desiredTarget.current.set(px, 0.6, pz);
      // keep the operator's chosen orbit direction but re-anchor behind the unit
      const dir = new THREE.Vector3().subVectors(camera.position, c.target);
      if (dir.lengthSq() < 1) dir.set(9, 11, 9);
      dir.y = Math.max(dir.y, 6);
      dir.setLength(15);
      desired.current.copy(desiredTarget.current).add(dir);
      const k = 1 - Math.pow(0.0016, dt);
      camera.position.lerp(desired.current, k);
      c.target.lerp(desiredTarget.current, k);
      c.update();
      return;
    }

    if (lastMode.current !== mode) {
      lastMode.current = mode;
      animating.current = true;
    }
    if (!animating.current) return;

    const v = VIEWS[mode] ?? VIEWS.ORBIT;
    desired.current.set(v.pos[0], v.pos[1], v.pos[2]);
    desiredTarget.current.set(v.target[0], v.target[1], v.target[2]);
    const k = 1 - Math.pow(0.002, dt);
    camera.position.lerp(desired.current, k);
    c.target.lerp(desiredTarget.current, k);
    c.update();
    if (camera.position.distanceTo(desired.current) < 0.4) animating.current = false;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.075}
      minDistance={6}
      maxDistance={95}
      maxPolarAngle={Math.PI * 0.495}
      minPolarAngle={0.05}
      target={[0, 0, 0]}
      onStart={() => (animating.current = false)}
    />
  );
}
