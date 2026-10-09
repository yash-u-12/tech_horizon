import clsx from 'clsx';
import { ArrowRight, Gauge, ShieldCheck, Timer, TrafficCone } from 'lucide-react';
import { Scene } from '@/warehouse/Scene';
import { useNexus } from '@/store/useNexus';
import { Chip, Dot, Empty, KV, Panel, Sparkline, Stat, type Tone } from '@/components/ui';

const SEV_TONE: Record<string, Tone> = {
  LOW: 'steel',
  MEDIUM: 'warn',
  HIGH: 'warn',
  CRITICAL: 'danger',
};

export function Traffic() {
  const snap = useNexus((s) => s.snap);
  const selectRobot = useNexus((s) => s.selectRobot);

  const resolved = snap.conflicts.filter((c) => c.resolved);
  const active = snap.conflicts.filter((c) => !c.resolved);
  const minTtc = snap.conflicts.length ? Math.min(...snap.conflicts.map((c) => c.ttc)) : Infinity;

  return (
    <div className="flex min-h-0 flex-1 gap-3 bg-void p-3">
      {/* ── 3D with the traffic layer forced on ───────────────────────────── */}
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-line2">
        <Scene />
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded border border-line2 bg-panel/95 px-2.5 py-1.5 backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            <TrafficCone size={11} className="text-warn" />
            <span className="label">CONFLICT RESOLUTION VIEW</span>
          </div>
          <div className="mt-1 text-3xs leading-tight text-txt3">
            Rings mark predicted conflicts · labels show time-to-closest-approach
          </div>
        </div>
      </div>

      {/* ── right: traffic analysis ───────────────────────────────────────── */}
      <div className="flex w-[380px] shrink-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="panel p-3">
            <Stat label="ACTIVE" value={`${active.length}`} tone={active.length ? 'warn' : 'ok'} />
          </div>
          <div className="panel p-3">
            <Stat label="RESOLVED" value={`${resolved.length}`} tone="ok" />
          </div>
          <div className="panel p-3">
            <Stat label="NEAR MISS" value={`${snap.metrics.nearMisses}`} tone={snap.metrics.nearMisses ? 'warn' : 'ok'} />
          </div>
        </div>

        <Panel title="PREDICTED CONFLICTS" className="min-h-0 flex-1" dense>
          <div className="h-full overflow-auto">
            {snap.conflicts.length === 0 && (
              <Empty>
                NO CONFLICTS PREDICTED
                <br />
                <span className="text-3xs">the fleet is flowing</span>
              </Empty>
            )}
            {snap.conflicts.map((c) => (
              <div
                key={c.id}
                className={clsx(
                  'border-b border-line/50 px-3 py-2',
                  c.resolved ? 'opacity-60' : '',
                )}
              >
                <div className="flex items-center gap-2">
                  <button className="mono text-[12px] font-semibold text-txt hover:text-nav" onClick={() => selectRobot(c.a)}>
                    {c.a}
                  </button>
                  <ArrowRight size={10} className="text-txt3" />
                  <button className="mono text-[12px] font-semibold text-txt hover:text-nav" onClick={() => selectRobot(c.b)}>
                    {c.b}
                  </button>
                  <Chip tone={SEV_TONE[c.severity]}>{c.severity}</Chip>
                  {c.resolved && (
                    <Chip tone="ok">
                      <ShieldCheck size={9} />
                      RESOLVED
                    </Chip>
                  )}
                  <span className="mono ml-auto text-[11px] text-txt2">TTC {c.ttc.toFixed(2)}s</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <KV k="GAP" v={`${c.distance.toFixed(2)} m`} />
                  <KV k="CPA" v={`${c.cpa.toFixed(2)} m`} />
                  <KV k="AT" v={`${c.at.x.toFixed(0)},${c.at.y.toFixed(0)}`} />
                </div>
                {c.resolution && (
                  <div className="mt-1 text-3xs leading-tight text-ok">
                    {c.resolvedBy ? `${c.resolvedBy}: ` : ''}
                    {c.resolution}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="TRAFFIC EVENT LOG" className="h-[210px]" dense>
          <div className="h-full overflow-auto">
            {snap.traffic.length === 0 && <Empty>NO TRAFFIC EVENTS RECORDED</Empty>}
            {snap.traffic.map((e) => (
              <div key={e.id} className="flex items-start gap-2 border-b border-line/40 px-3 py-1">
                <Dot tone={SEV_TONE[e.severity]} />
                <span className="mono mt-[1px] shrink-0 text-[10px] tabular-nums text-txt3">{e.at.toFixed(1)}</span>
                <span className="min-w-0 flex-1 text-[11px] leading-snug text-txt2">{e.message}</span>
                {e.ttc != null && <span className="mono shrink-0 text-[10px] text-warn">{e.ttc.toFixed(2)}s</span>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="FLOW" dense>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="MIN TTC" value={Number.isFinite(minTtc) ? minTtc.toFixed(2) : '—'} unit="s" tone={minTtc < 1.5 ? 'danger' : 'default'} />
            <Stat label="AVG SPEED" value={snap.fleet.avgSpeed.toFixed(2)} unit="m/s" />
            <Stat label="REPLANS" value={`${snap.metrics.replans}`} tone="analysis" />
          </div>
          <div className="mt-2.5">
            <div className="mb-1 flex items-center gap-1.5">
              <Gauge size={10} className="text-txt3" />
              <span className="label">CONGESTION HISTORY</span>
            </div>
            <Sparkline data={snap.traffic.slice(0, 40).map((_, i) => snap.traffic.length - i).reverse()} color="#FBBF24" height={28} width={330} />
          </div>
          <div className="mt-2 border-t border-line pt-2 text-3xs leading-relaxed text-txt3">
            There is no traffic controller. Every agent predicts conflicts from its own sensor view,
            and when two agents detect the same pair they run the same symmetric right-of-way rule —
            so they agree on who yields without either one being in charge.
          </div>
        </Panel>
      </div>
    </div>
  );
}

export { Timer };
