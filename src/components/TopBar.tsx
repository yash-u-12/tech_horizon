import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  Boxes,
  Crosshair,
  Eye,
  Gauge,
  Grid3x3,
  Hand,
  Layers,
  MapPin,
  Maximize2,
  MousePointerClick,
  Move,
  Pause,
  Play,
  RotateCcw,
  Route,
  Timer,
  Trash2,
  TriangleAlert,
  Zap,
  ZoomIn,
} from 'lucide-react';
import { runtime } from '@/simulation/runtime';
import { useNexus, type CameraMode, type LayerState } from '@/store/useNexus';
import { Chip, Dot, Segmented } from './ui';

const SPEEDS = [1, 2, 5];

export function TopBar() {
  const snap = useNexus((s) => s.snap);
  const setCameraMode = useNexus((s) => s.setCameraMode);
  const cameraMode = useNexus((s) => s.cameraMode);
  const cameraGesture = useNexus((s) => s.cameraGesture);
  const cameraPinchZoom = useNexus((s) => s.cameraPinchZoom);
  const setCameraGesture = useNexus((s) => s.setCameraGesture);
  const setCameraPinchZoom = useNexus((s) => s.setCameraPinchZoom);
  const layers = useNexus((s) => s.layers);
  const toggleLayer = useNexus((s) => s.toggleLayer);
  const clickMode = useNexus((s) => s.clickMode);
  const setClickMode = useNexus((s) => s.setClickMode);
  const notify = useNexus((s) => s.notify);
  const [, force] = useState(0);

  // force a re-render when engine control state changes outside the snapshot
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 400);
    return () => clearInterval(id);
  }, []);

  const e = runtime.engine;
  const mm = Math.floor(snap.time / 60);
  const ss = (snap.time % 60).toFixed(1).padStart(4, '0');

  return (
    <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line bg-abyss px-3">
      {/* ── clock + transport ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Timer size={13} className="text-txt3" />
          <span className="mono text-[15px] font-medium leading-none text-txt">
            {mm}:{ss}
          </span>
        </div>
        <Chip tone={snap.running ? 'ok' : 'warn'}>
          <Dot tone={snap.running ? 'ok' : 'warn'} pulse={snap.running} />
          {snap.running ? 'RUNNING' : 'PAUSED'}
        </Chip>
      </div>

      <div className="h-5 w-px bg-line" />

      <div className="flex items-center gap-1">
        <button
          className={clsx('btn-icon', snap.running && 'text-nav')}
          title={snap.running ? 'Pause simulation' : 'Resume simulation'}
          onClick={() => {
            e.setRunning(!e.running);
            useNexus.getState().notify(e.running ? 'SIMULATION RESUMED' : 'SIMULATION PAUSED');
          }}
        >
          {snap.running ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <div className="ml-1 flex overflow-hidden rounded border border-line2">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => e.setSpeed(s)}
              className={clsx(
                'px-1.5 py-1 text-2xs font-semibold tabular-nums transition-colors',
                Math.round(e.speed) === s ? 'bg-nav/[0.16] text-nav' : 'bg-raised/40 text-txt3 hover:text-txt2',
              )}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          className="btn-icon ml-1"
          title="Reset simulation"
          onClick={() => {
            runtime.reset();
            useNexus.getState().selectRobot(null);
            useNexus.getState().selectTask(null);
            notify('SIMULATION RESET', 'INFO');
          }}
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="h-5 w-px bg-line" />

      {/* ── live fleet counters ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <MiniStat icon={<Boxes size={11} />} label="ACTIVE" value={`${snap.fleet.activeRobots - snap.fleet.idleRobots}/${snap.fleet.activeRobots}`} />
        <MiniStat
          icon={<Route size={11} />}
          label="TASKS"
          value={`${snap.fleet.tasksActive}`}
          tone={snap.fleet.tasksActive > 0 ? 'nav' : 'default'}
        />
        <MiniStat icon={<Zap size={11} />} label="DONE" value={`${snap.fleet.tasksCompleted}`} tone="ok" />
        <MiniStat
          icon={<TriangleAlert size={11} />}
          label="CONFLICTS"
          value={`${snap.conflicts.length}`}
          tone={snap.conflicts.length ? 'warn' : 'default'}
        />
        <MiniStat icon={<Gauge size={11} />} label="UTIL" value={`${(snap.fleet.utilisation * 100).toFixed(0)}%`} />
      </div>

      {/* ── spacer ────────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── tools ─────────────────────────────────────────────────────────── */}
      <button
        className={clsx('btn', clickMode === 'PLACE_OBSTACLE' && 'btn-danger')}
        title="Click the floor to drop a temporary obstacle — robots must perceive and replan around it"
        onClick={() => setClickMode(clickMode === 'PLACE_OBSTACLE' ? 'SELECT' : 'PLACE_OBSTACLE')}
      >
        <TriangleAlert size={12} />
        OBSTACLE
      </button>
      <button
        className={clsx('btn', clickMode === 'PLACE_TASK' && 'btn-primary')}
        title="Click a pick location then a destination to inject a manual order"
        onClick={() => setClickMode(clickMode === 'PLACE_TASK' ? 'SELECT' : 'PLACE_TASK')}
      >
        <MapPin size={12} />
        ORDER
      </button>
      <button
        className="btn"
        title="Clear all temporary obstacles"
        onClick={() => {
          e.clearObstacles();
          notify('TEMPORARY OBSTACLES CLEARED', 'SUCCESS');
        }}
      >
        <Trash2 size={12} />
        CLEAR
      </button>

      <div className="h-5 w-px bg-line" />

      {/* ── camera + layers ───────────────────────────────────────────────── */}
      <Segmented<CameraMode>
        value={cameraMode}
        onChange={setCameraMode}
        options={[
          { id: 'ORBIT', label: 'ORBIT', title: 'Free orbit camera' },
          { id: 'TOP', label: 'TOP', title: 'Top-down plan view' },
          { id: 'ISO', label: 'ISO', title: 'Isometric view' },
          { id: 'FOLLOW', label: 'FOLLOW', title: 'Follow the selected robot' },
        ]}
      />

      <div className="flex items-center gap-1" aria-label="Simulation camera gestures">
        <button
          className={clsx('btn', cameraGesture === 'DRAG' && 'btn-primary')}
          title="Left drag rotates the camera; right drag pans"
          aria-pressed={cameraGesture === 'DRAG'}
          onClick={() => setCameraGesture('DRAG')}
        >
          <Move size={12} />
          DRAG
        </button>
        <button
          className={clsx('btn', cameraGesture === 'PAN' && 'btn-primary')}
          title="Swap drag actions: left drag pans; right drag rotates"
          aria-pressed={cameraGesture === 'PAN'}
          onClick={() => setCameraGesture('PAN')}
        >
          <Hand size={12} />
          PAN
        </button>
        <button
          className={clsx('btn', cameraPinchZoom && 'btn-primary')}
          title="Enable or disable touch pinch and mouse wheel zoom"
          aria-pressed={cameraPinchZoom}
          onClick={() => setCameraPinchZoom(!cameraPinchZoom)}
        >
          <ZoomIn size={12} />
          PINCH
        </button>
      </div>

      <LayerMenu layers={layers} toggleLayer={toggleLayer} />
      <button className="btn-icon" title="Reset camera" onClick={() => setCameraMode(cameraMode)}>
        <Maximize2 size={13} />
      </button>

      {clickMode !== 'SELECT' && (
        <div className="absolute left-1/2 top-[54px] z-40 -translate-x-1/2 rounded border border-nav/40 bg-void/95 px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-nav shadow-lg">
          <MousePointerClick size={11} className="mr-1.5 inline" />
          {clickMode === 'PLACE_OBSTACLE' ? 'CLICK THE FLOOR TO PLACE AN OBSTACLE' : 'CLICK A PICK LOCATION'}
          <button className="ml-2 text-txt3 hover:text-txt" onClick={() => setClickMode('SELECT')}>
            ESC
          </button>
        </div>
      )}
    </header>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'nav' | 'ok' | 'warn' | 'danger';
}) {
  const color =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : tone === 'nav' ? 'text-nav' : 'text-txt';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-txt3">{icon}</span>
      <span className="text-3xs font-semibold uppercase tracking-[0.12em] text-txt3">{label}</span>
      <span className={clsx('mono text-[12px] font-medium leading-none', color)}>{value}</span>
    </div>
  );
}

const LAYER_DEFS: { key: keyof LayerState; label: string; icon: React.ReactNode }[] = [
  { key: 'paths', label: 'ROUTES', icon: <Route size={11} /> },
  { key: 'trails', label: 'TRAILS', icon: <Maximize2 size={11} /> },
  { key: 'perception', label: 'PERCEPTION', icon: <Eye size={11} /> },
  { key: 'occupancy', label: 'OCCUPANCY', icon: <Grid3x3 size={11} /> },
  { key: 'traffic', label: 'TRAFFIC', icon: <TriangleAlert size={11} /> },
  { key: 'zones', label: 'ZONES', icon: <MapPin size={11} /> },
  { key: 'packages', label: 'CARGO', icon: <Boxes size={11} /> },
  { key: 'labels', label: 'LABELS', icon: <Crosshair size={11} /> },
  { key: 'grid', label: 'GRID', icon: <Grid3x3 size={11} /> },
];

function LayerMenu({ layers, toggleLayer }: { layers: LayerState; toggleLayer: (k: keyof LayerState) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className={clsx('btn', open && 'border-nav/50 text-nav')} onClick={() => setOpen(!open)}>
        <Layers size={12} />
        LAYERS
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[34px] z-40 w-[188px] rounded border border-line2 bg-panel p-1.5 shadow-2xl">
            {LAYER_DEFS.map((d) => (
              <button
                key={d.key}
                onClick={() => toggleLayer(d.key)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-2xs font-semibold uppercase tracking-[0.1em] text-txt2 hover:bg-panel2"
              >
                <span className={layers[d.key] ? 'text-nav' : 'text-txt3'}>{d.icon}</span>
                <span className="flex-1">{d.label}</span>
                <span
                  className={clsx(
                    'h-3 w-5 rounded-full border transition-colors',
                    layers[d.key] ? 'border-nav/60 bg-nav/30' : 'border-line2 bg-raised',
                  )}
                >
                  <span
                    className={clsx(
                      'block h-[9px] w-[9px] rounded-full bg-txt transition-transform',
                      layers[d.key] ? 'translate-x-[10px] bg-nav' : 'translate-x-[2px] bg-txt3',
                    )}
                  />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
