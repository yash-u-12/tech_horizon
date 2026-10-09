import { Brackets, Camera, Eye, Layers, Plus, Route, Sparkles, Trash2 } from 'lucide-react'
import { Button, Chip, Panel, SegmentedControl, ToggleChip } from '../../components/ui'
import { useNexus } from '../../store/useNexus'

/** floating control surface over the warehouse — camera, overlays, work and demos */
export function CommandBar() {
  const overlays = useNexus((s) => s.overlays)
  const toggle = useNexus((s) => s.toggleOverlay)
  const cameraMode = useNexus((s) => s.cameraMode)
  const setCameraMode = useNexus((s) => s.setCameraMode)
  const createTask = useNexus((s) => s.createTask)
  const runScenario = useNexus((s) => s.runScenario)
  const clearObstacles = useNexus((s) => s.clearObstacles)
  const openCount = useNexus((s) => s.snapshot.openTasks.length)

  return (
    <Panel className="pointer-events-auto flex items-center gap-2 px-2 py-1.5" dense>
      <span className="flex items-center gap-1.5 pl-1 pr-2">
        <Camera size={12} className="text-nx-faint" />
        <SegmentedControl
          value={cameraMode}
          onChange={(v) => setCameraMode(v as never)}
          options={[
            { value: 'ORBIT', label: 'ORBIT', title: 'Free orbit' },
            { value: 'ISO', label: 'ISO', title: 'Isometric' },
            { value: 'TOP', label: 'TOP', title: 'Top down' },
            { value: 'FOLLOW', label: 'FOLLOW', title: 'Follow the selected agent' },
          ]}
        />
      </span>

      <span className="h-5 w-px bg-nx-line" />

      <span className="flex items-center gap-1 px-1">
        <Layers size={11} className="text-nx-faint" />
        <ToggleChip label="PATHS" on={overlays.paths} onClick={() => toggle('paths')} />
        <ToggleChip label="PERCEPTION" on={overlays.perception} onClick={() => toggle('perception')} />
        <ToggleChip label="TRAFFIC" on={overlays.traffic} onClick={() => toggle('traffic')} tone="orange" />
        <ToggleChip label="DENSITY" on={overlays.density} onClick={() => toggle('density')} />
        <ToggleChip label="ZONES" on={overlays.zones} onClick={() => toggle('zones')} />
        <ToggleChip label="TRAILS" on={overlays.trails} onClick={() => toggle('trails')} />
        <ToggleChip label="LABELS" on={overlays.labels} onClick={() => toggle('labels')} />
      </span>

      <span className="h-5 w-px bg-nx-line" />

      <span className="flex items-center gap-1 px-1">
        <Plus size={11} className="text-nx-faint" />
        <Button onClick={() => createTask('NORMAL')} title="Create a transport task — the fleet will bid for it">
          TASK
        </Button>
        <Button onClick={() => createTask('HIGH')} title="Create a HIGH priority task">
          HIGH
        </Button>
        <Button onClick={() => createTask('CRITICAL')} title="Create a CRITICAL priority task">
          CRIT
        </Button>
        <span className="ml-1 font-mono text-[9.5px] text-nx-faint">{openCount} open</span>
      </span>

      <span className="h-5 w-px bg-nx-line" />

      <span className="flex items-center gap-1 px-1">
        <Sparkles size={11} className="text-nx-faint" />
        <Button onClick={() => runScenario('blocked_aisle')} title="Drop a pallet across the busiest aisle">
          <Route size={10} /> BLOCK AISLE
        </Button>
        <Button onClick={() => runScenario('robot_failure')} title="Fail a loaded agent and watch the fleet recover its task">
          FAIL AGENT
        </Button>
        <Button onClick={() => runScenario('agent_deployment')} title="Run the full sim-to-real deployment sequence">
          DEPLOY DEMO
        </Button>
        <Button onClick={clearObstacles} title="Remove scenario obstacles">
          <Trash2 size={10} />
        </Button>
      </span>

      <span className="h-5 w-px bg-nx-line" />
      <Chip tone="neutral" className="mr-1">
        <Eye size={9} /> click a robot for its context
      </Chip>
      <Chip tone="neutral">
        <Brackets size={9} /> alt+1..7 pages
      </Chip>
    </Panel>
  )
}

export function Toast() {
  const toast = useNexus((s) => s.toast)
  const clear = useNexus((s) => s.clearToast)
  if (!toast) return null
  const tone =
    toast.level === 'CRITICAL' ? 'border-nx-red/50 bg-nx-red/[0.12] text-nx-red' : toast.level === 'WARN' ? 'border-nx-amber/50 bg-nx-amber/[0.12] text-nx-amber' : toast.level === 'SUCCESS' ? 'border-nx-green/50 bg-nx-green/[0.12] text-nx-green' : 'border-nx-cyan/50 bg-nx-cyan/[0.12] text-nx-cyan'
  return (
    <div className={`nx-rise pointer-events-auto flex max-w-[520px] items-center gap-2 rounded border px-3 py-2 text-[11px] backdrop-blur ${tone}`} onClick={clear}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span className="leading-snug">{toast.text}</span>
    </div>
  )
}
