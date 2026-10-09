import clsx from 'clsx';
import { OctagonAlert, Plus, Radar, X } from 'lucide-react';
import { runtime } from '@/simulation/runtime';
import { SCENARIOS } from '@/simulation/scenarios/scenarios';
import { useNexus } from '@/store/useNexus';
import { Chip, Dot } from './ui';

/**
 * Presenter controls. Every button mutates real simulation state — these are
 * not UI-only effects.
 */
export function ScenarioBar() {
  const snap = useNexus((s) => s.snap);
  const notify = useNexus((s) => s.notify);
  const setPage = useNexus((s) => s.setPage);

  const trigger = (id: string) => {
    runtime.engine.triggerScenario(id);
    const sc = SCENARIOS.find((s) => s.id === id);
    notify(`${sc?.code ?? id} · ${sc?.name ?? ''} ENGAGED`, sc?.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING');
    runtime.emit();
  };

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-abyss px-3 py-2">
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <Radar size={13} className="text-txt3" />
        <span className="label whitespace-nowrap">SCENARIOS</span>
      </div>

      {SCENARIOS.map((s) => {
        const active = snap.activeScenario === s.id;
        return (
          <button
            key={s.id}
            onClick={() => trigger(s.id)}
            title={s.description}
            className={clsx(
              'group flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-2xs font-semibold uppercase tracking-[0.1em] transition-colors',
              active
                ? 'border-nav/60 bg-nav/[0.16] text-nav'
                : 'border-line2 bg-raised/40 text-txt2 hover:border-steel/60 hover:text-txt',
            )}
          >
            <span
              className={clsx(
                'mono text-[10px] font-bold',
                s.severity === 'CRITICAL' ? 'text-danger' : s.severity === 'WARNING' ? 'text-warn' : 'text-txt3',
              )}
            >
              {s.id}
            </span>
            {s.name}
          </button>
        );
      })}

      <div className="mx-1 h-5 w-px shrink-0 bg-line" />

      <button
        className="btn shrink-0"
        onClick={() => {
          runtime.engine.clearScenario();
          notify('SCENARIO CLEARED · RETURNED TO BASELINE', 'SUCCESS');
          runtime.emit();
        }}
        disabled={!snap.activeScenario}
      >
        <X size={12} />
        CLEAR
      </button>

      <button
        className="btn btn-primary shrink-0"
        onClick={() => {
          const t = runtime.engine.forceOrder();
          if (t) {
            useNexus.getState().selectTask(t.id);
            notify(`${t.id} INJECTED · ANNOUNCED TO FLEET`, 'SUCCESS');
          }
          runtime.emit();
        }}
      >
        <Plus size={12} />
        INJECT ORDER
      </button>

      <div className="flex-1" />

      {snap.activeScenario && (
        <Chip tone="nav" className="shrink-0">
          <Dot tone="nav" pulse />
          ACTIVE · {SCENARIOS.find((s) => s.id === snap.activeScenario)?.name}
        </Chip>
      )}

      <button
        className="btn btn-danger shrink-0"
        title="Emergency stop — safety layer overrides all commands"
        onClick={() => {
          runtime.engine.estop('*');
          notify('FLEET EMERGENCY STOP ENGAGED', 'CRITICAL');
          runtime.emit();
        }}
      >
        <OctagonAlert size={12} />
        E-STOP
      </button>
      <button
        className="btn shrink-0"
        onClick={() => {
          runtime.engine.clearEstop('*');
          for (const a of runtime.engine.agents) if (a.state.status === 'OFFLINE') a.recover(runtime.engine['world']);
          notify('E-STOP CLEARED', 'SUCCESS');
          runtime.emit();
        }}
      >
        RESET E-STOP
      </button>
      <button className="btn shrink-0" onClick={() => setPage('EXPERIMENTS')}>
        RUN TRIAL
      </button>
    </div>
  );
}
