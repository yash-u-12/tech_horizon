/**
 * UI store.
 *
 * IMPORTANT: this store holds the 10 Hz snapshot for PANELS ONLY. The 3D scene
 * never subscribes to it — it reads `runtime.engine` directly inside useFrame,
 * which is what keeps the warehouse at full frame rate.
 */

import { create } from 'zustand';
import { runtime, DEFAULT_CONFIG } from '@/simulation/runtime';
import type { Snapshot } from '@/simulation/engine';

export type PageId = 'COMMAND' | 'FLEET' | 'TASKS' | 'COMMS' | 'TWIN' | 'EXPERIMENTS' | 'SYSTEM';

export interface LayerState {
  paths: boolean;
  trails: boolean;
  perception: boolean;
  traffic: boolean;
  zones: boolean;
  labels: boolean;
  packages: boolean;
  grid: boolean;
  occupancy: boolean;
}

export type CameraMode = 'ORBIT' | 'TOP' | 'ISO' | 'FOLLOW';

interface NexusState {
  snap: Snapshot;
  page: PageId;
  selectedRobot: string | null;
  selectedTask: string | null;
  hoveredRobot: string | null;
  followId: string | null;
  cameraMode: CameraMode;
  cameraGesture: 'DRAG' | 'PAN';
  cameraPinchZoom: boolean;
  layers: LayerState;
  bindingFor: string | null;
  inspector: 'ROBOT' | 'TASK' | null;
  taskFilter: string;
  fleetFilter: string;
  fleetQuery: string;
  toast: { id: number; message: string; severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL' } | null;
  experiments: import('@/simulation/types').ExperimentResult[];
  runningExperiment: string | null;
  clickMode: 'SELECT' | 'PLACE_OBSTACLE' | 'PLACE_TASK';
  placeFrom: { x: number; y: number } | null;

  setPage: (p: PageId) => void;
  selectRobot: (id: string | null) => void;
  selectTask: (id: string | null) => void;
  hoverRobot: (id: string | null) => void;
  setFollow: (id: string | null) => void;
  setCameraMode: (m: CameraMode) => void;
  setCameraGesture: (m: 'DRAG' | 'PAN') => void;
  setCameraPinchZoom: (enabled: boolean) => void;
  toggleLayer: (k: keyof LayerState) => void;
  setLayer: (k: keyof LayerState, v: boolean) => void;
  openBinding: (robotId: string | null) => void;
  closeBinding: () => void;
  setInspector: (i: 'ROBOT' | 'TASK' | null) => void;
  setTaskFilter: (s: string) => void;
  setFleetFilter: (s: string) => void;
  setFleetQuery: (s: string) => void;
  notify: (message: string, severity?: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL') => void;
  addExperiment: (r: import('@/simulation/types').ExperimentResult) => void;
  setExperiments: (r: import('@/simulation/types').ExperimentResult[]) => void;
  clearToast: () => void;
  setRunningExperiment: (id: string | null) => void;
  setClickMode: (m: 'SELECT' | 'PLACE_OBSTACLE' | 'PLACE_TASK') => void;
  setPlaceFrom: (p: { x: number; y: number } | null) => void;
  rebuild: (robotCount?: number) => void;
}

let toastId = 0;

export const useNexus = create<NexusState>((set, get) => ({
  snap: runtime.snapshot,
  page: 'COMMAND',
  selectedRobot: null,
  selectedTask: null,
  hoveredRobot: null,
  followId: null,
  cameraMode: 'ORBIT',
  cameraGesture: 'DRAG',
  cameraPinchZoom: true,
  layers: {
    paths: true,
    trails: true,
    perception: false,
    traffic: true,
    zones: true,
    labels: true,
    packages: true,
    grid: false,
    occupancy: false,
  },
  bindingFor: null,
  inspector: null,
  taskFilter: 'ALL',
  fleetFilter: 'ALL',
  fleetQuery: '',
  toast: null,
  experiments: [],
  runningExperiment: null,
  clickMode: 'SELECT',
  placeFrom: null,

  setPage: (page) => set({ page }),
  selectRobot: (id) => set({ selectedRobot: id, inspector: id ? 'ROBOT' : null }),
  selectTask: (id) => set({ selectedTask: id, selectedRobot: id ? null : get().selectedRobot, inspector: id ? 'TASK' : null }),
  hoverRobot: (id) => set({ hoveredRobot: id }),
  setFollow: (id) => set({
    followId: id,
    cameraMode: id ? 'FOLLOW' : 'ORBIT',
    ...(id ? { selectedRobot: id, selectedTask: null, inspector: 'ROBOT' as const } : {}),
  }),
  setCameraMode: (cameraMode) => set({ cameraMode, followId: cameraMode === 'FOLLOW' ? get().followId : null }),
  setCameraGesture: (cameraGesture) => set({ cameraGesture }),
  setCameraPinchZoom: (cameraPinchZoom) => set({ cameraPinchZoom }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
  openBinding: (bindingFor) => set({ bindingFor }),
  closeBinding: () => set({ bindingFor: null }),
  setInspector: (inspector) => set({ inspector }),
  setTaskFilter: (taskFilter) => set({ taskFilter }),
  setFleetFilter: (fleetFilter) => set({ fleetFilter }),
  setFleetQuery: (fleetQuery) => set({ fleetQuery }),
  notify: (message, severity = 'INFO') => {
    toastId++;
    set({ toast: { id: toastId, message, severity } });
    setTimeout(() => {
      if (get().toast?.id === toastId) set({ toast: null });
    }, 3600);
  },
  addExperiment: (r) => set((s) => ({ experiments: [r, ...s.experiments].slice(0, 12) })),
  setExperiments: (experiments) => set({ experiments }),
  clearToast: () => set({ toast: null }),
  setRunningExperiment: (runningExperiment) => set({ runningExperiment }),
  setClickMode: (clickMode) => set({ clickMode, placeFrom: null }),
  setPlaceFrom: (placeFrom) => set({ placeFrom }),
  rebuild: (robotCount) => {
    runtime.rebuild({ robotCount: robotCount ?? DEFAULT_CONFIG.robotCount });
    set({ snap: runtime.snapshot, selectedRobot: null, selectedTask: null, inspector: null, followId: null });
  },
}));

// Bridge the engine's 10 Hz snapshot into the store.
// (Fleet telemetry for Firebase lives in integrations/fleetPublisher — 5 s.)
runtime.subscribe((snap) => useNexus.setState({ snap }));

// ── convenience selectors ───────────────────────────────────────────────────

export const selRobot = (id: string | null) => (s: NexusState) =>
  id ? s.snap.robots.find((r) => r.id === id) ?? null : null;

export const selTask = (id: string | null) => (s: NexusState) =>
  id ? s.snap.tasks.find((t) => t.id === id) ?? null : null;
