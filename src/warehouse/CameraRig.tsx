import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { tx, tz } from './shared';
import type { CameraMode } from '@/store/useNexus';

interface Props {
  mode: CameraMode;
  gesture: 'DRAG' | 'PAN';
  pinchZoom: boolean;
  followPose: { x: number; y: number } | null;
  resetKey: number;
}

const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  ORBIT: { pos: [26, 30, 34], target: [0, 0, 0] },
  TOP: { pos: [0, 62, 0.01], target: [0, 0, 0] },
  ISO: { pos: [34, 24, -34], target: [0, 0, 0] },
};

export function CameraRig({ mode, gesture, pinchZoom, followPose, resetKey }: Props) {
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
      const k = 1 - Math.pow(0.0016, dt);
      // Translate the camera and target together. This follows the robot while
      // preserving the operator's current orbit, zoom, and pan adjustments.
      desired.current.copy(desiredTarget.current).sub(c.target).multiplyScalar(k);
      camera.position.add(desired.current);
      c.target.add(desired.current);
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
      mouseButtons={{
        LEFT: gesture === 'PAN' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: gesture === 'PAN' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
      }}
      enableRotate
      enablePan
      enableZoom={pinchZoom}
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
