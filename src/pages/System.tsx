import { useState } from 'react';
import clsx from 'clsx';
import { Cog, Network, Radio, RefreshCw, Server, Sliders, Trash2 } from 'lucide-react';
import { runtime, DEFAULT_CONFIG } from '@/simulation/runtime';
import { useNexus } from '@/store/useNexus';
import { WORLD_H, WORLD_W } from '@/simulation/environment/warehouse';
import { SCENARIOS } from '@/simulation/scenarios/scenarios';
import { Chip, Dot, KV, Panel, Segmented, Sparkline, Stat, type Tone } from '@/components/ui';

const NODE_TONE: Record<string, Tone> = {
  ONLINE: 'ok',
  DEGRADED: 'warn',
  OFFLINE: 'danger',
};

export function SystemPage() {
  const snap = useNexus((s) => s.snap);
  const notify = useNexus((s) => s.notify);
  const selectRobot = useNexus((s) => s.selectRobot);
  const [robots, setRobots] = useState(String(DEFAULT_CONFIG.robotCount));
  const [seed, setSeed] = useState(String(DEFAULT_CONFIG.seed));

  const layers = ['AGENT', 'SIMULATION', 'GATEWAY', 'BACKEND', 'HARDWARE', 'VISUALISATION'] as const;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-void p-3">
      {/* ── topology strip ──────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center gap-2 rounded-md border border-line2 bg-abyss/50 px-3 py-2">
        <Network size={13} className="text-txt3" />
        <span className="label">DATA FLOW</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['AGENT LAYER', 'per-robot context · decision · planning'],
              ['SIMULATION CORE', 'world · occupancy · collision'],
              ['COMMS BUS', 'latency + loss per link'],
              ['BACKEND / STATE BRIDGE', 'snapshot @ 10 Hz'],
              ['HARDWARE BRIDGE', 'ROS 2 / mock transport'],
              ['VISUALISATION', 'R3F reads live state @ 60 Hz'],
            ] as const
          ).map(([a, b], i) => (
            <span key={a} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-txt3">→</span>}
              <Chip tone="steel" title={b}>{a}</Chip>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_420px] gap-3">
        <div className="flex flex-col gap-3">
          {/* ── nodes ─────────────────────────────────────────────────────── */}
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Server size={12} className="text-txt3" />
                SYSTEM NODES
              </span>
            }
            dense
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="bg-abyss/70">
                    <th className="th text-left">NODE</th>
                    <th className="th text-left">LAYER</th>
                    <th className="th text-center">STATUS</th>
                    <th className="th text-right">LATENCY</th>
                    <th className="th text-right">HEARTBEAT</th>
                    <th className="th text-right">LOSS</th>
                    <th className="th text-right">UPTIME</th>
                    <th className="th text-left">DETAIL</th>
                    <th className="th text-right">VERSION</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.nodes.map((n) => (
                    <tr key={n.id} className="border-t border-line/50">
                      <td className="px-2 py-1.5">
                        <span className="mono text-[11px] font-semibold text-txt">{n.id}</span>
                      </td>
                      <td className="px-2 py-1.5 text-3xs uppercase tracking-[0.1em] text-txt3">{n.layer}</td>
                      <td className="px-2 py-1.5 text-center">
                        <Chip tone={NODE_TONE[n.status]}>
                          <Dot tone={NODE_TONE[n.status]} pulse={n.status === 'ONLINE'} />
                          {n.status}
                        </Chip>
                      </td>
                      <td className="mono px-2 py-1.5 text-right text-[11px] text-txt2">{n.latencyMs.toFixed(0)}ms</td>
                      <td className="mono px-2 py-1.5 text-right text-[11px] text-txt2">{n.heartbeatMs.toFixed(0)}ms</td>
                      <td className="mono px-2 py-1.5 text-right text-[11px]">{(n.packetLoss * 100).toFixed(1)}%</td>
                      <td className="mono px-2 py-1.5 text-right text-[11px] text-txt2">{n.uptime.toFixed(0)}s</td>
                      <td className="max-w-[280px] truncate px-2 py-1.5 text-[11px] text-txt2" title={n.detail}>{n.detail}</td>
                      <td className="mono px-2 py-1.5 text-right text-3xs text-txt3">{n.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── comms ─────────────────────────────────────────────────────── */}
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Radio size={12} className="text-txt3" />
                COMMUNICATION
              </span>
            }
            dense
          >
            <div className="grid grid-cols-4 gap-3 p-3">
              <Stat label="PACKET LOSS" value={`${(snap.commsLoss * 100).toFixed(2)}`} unit="%" tone={snap.commsLoss > 0.05 ? 'warn' : 'ok'} />
              <Stat label="LATENCY" value={`${(snap.commsLatency * 1000).toFixed(0)}`} unit="ms" tone={snap.commsLatency > 0.2 ? 'warn' : 'ok'} />
              <Stat label="PACKETS DROPPED" value={`${snap.packetsDropped}`} tone={snap.packetsDropped > 500 ? 'warn' : 'default'} />
              <Stat label="AVG ROBOT LATENCY" value={`${snap.fleet.avgLatency.toFixed(0)}`} unit="ms" />
            </div>
            <div className="border-t border-line px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="label">PER-AGENT LINK QUALITY</span>
              </div>
              <div className="grid grid-cols-3 gap-x-6 gap-y-0">
                {snap.robots.map((r) => (
                  <button
                    key={r.id}
                    className="flex items-center gap-2 py-[3px] text-left hover:bg-panel2/50"
                    onClick={() => { selectRobot(r.id); useNexus.getState().setPage('COMMAND'); }}
                  >
                    <span className="mono w-8 text-[11px] text-txt">{r.id}</span>
                    <span className={clsx('mono text-[11px]', r.connected ? 'text-ok' : 'text-danger')}>
                      {r.connected ? `${r.latencyMs.toFixed(0)}ms` : 'DOWN'}
                    </span>
                    <span className="mono ml-auto text-3xs text-txt3">{(r.packetLoss * 100).toFixed(1)}%</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-line px-3 py-2 text-3xs leading-relaxed text-txt3">
              Messages are not broadcast truthfully: the bus applies latency, jitter and per-recipient
              loss independently, so two agents can genuinely disagree about what they saw. Nothing in
              the simulation reads global state except the visualiser.
            </div>
          </Panel>

          {/* ── warehouse ─────────────────────────────────────────────────── */}
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Cog size={12} className="text-txt3" />
                WORLD
              </span>
            }
            dense
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-0 p-3">
              <KV k="DIMENSIONS" v={`${WORLD_W} × ${WORLD_H} m`} />
              <KV k="CORRIDOR WIDTH" v="2.5 m" />
              <KV k="SIM TIMESTEP" v="100 ms" />
              <KV k="SNAPSHOT RATE" v="10 Hz" />
              <KV k="RENDER" v="60 fps (direct read)" />
              <KV k="AGENTS" v={`${snap.robots.length}`} />
              <KV k="TEMP OBSTACLES" v={`${snap.obstacles.filter((o) => !o.id.startsWith('RACK')).length}`} />
              <KV k="SCENARIOS" v={`${SCENARIOS.length}`} />
            </div>
          </Panel>
        </div>

        {/* ── config / control ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Sliders size={12} className="text-txt3" />
                SIMULATION CONFIGURATION
              </span>
            }
            dense
          >
            <div className="p-3">
              <label className="label mb-1 block">AGENT COUNT</label>
              <Segmented
                value={robots}
                onChange={setRobots}
                options={['3', '4', '5', '6', '8'].map((n) => ({ id: n, label: n }))}
              />
              <label className="label mb-1 mt-3 block">SEED</label>
              <input
                className="input mono"
                value={seed}
                onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))}
              />
              <div className="mt-3 flex gap-1.5">
                <button
                  className={clsx('btn btn-primary flex-1 justify-center')}
                  onClick={() => {
                    runtime.rebuild({ robotCount: Number(robots), seed: Number(seed) });
                    useNexus.getState().selectRobot(null);
                    useNexus.getState().selectTask(null);
                    notify('WORLD REBUILT', 'SUCCESS');
                  }}
                >
                  <RefreshCw size={11} />
                  REBUILD WORLD
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setRobots(String(DEFAULT_CONFIG.robotCount));
                    setSeed(String(DEFAULT_CONFIG.seed));
                  }}
                >
                  DEFAULTS
                </button>
              </div>
              <div className="mt-2 text-3xs leading-relaxed text-txt3">
                Same seed + same config = identical run. The simulation is deterministic so a demo can
                be reproduced exactly and an experiment means something.
              </div>
            </div>
          </Panel>

          <Panel
            title={
              <span className="flex items-center gap-2">
                <Trash2 size={12} className="text-txt3" />
                DANGER ZONE
              </span>
            }
            dense
          >
            <div className="flex flex-col gap-1.5 p-3">
              <button
                className="btn btn-danger justify-center"
                onClick={() => {
                  runtime.engine.estop('*');
                  notify('FLEET E-STOP ENGAGED', 'CRITICAL');
                  runtime.emit();
                }}
              >
                FLEET EMERGENCY STOP
              </button>
              <button
                className="btn justify-center"
                onClick={() => {
                  runtime.engine.clearEstop('*');
                  notify('E-STOP CLEARED', 'SUCCESS');
                  runtime.emit();
                }}
              >
                CLEAR ALL E-STOPS
              </button>
              <button
                className="btn justify-center"
                onClick={() => {
                  runtime.reset();
                  notify('SIMULATION RESET', 'INFO');
                }}
              >
                RESET SIMULATION
              </button>
            </div>
          </Panel>

          <Panel title="TICK + RENDER HEALTH" dense>
            <div className="p-3">
              <KV k="SIM TIME" v={`${snap.time.toFixed(1)} s`} />
              <KV k="TICK" v={`${snap.tick}`} />
              <KV k="SPEED" v={`${snap.speed}×`} tone={snap.speed > 1 ? 'nav' : 'default'} />
              <KV k="STATE" v={snap.running ? 'RUNNING' : 'PAUSED'} tone={snap.running ? 'ok' : 'warn'} />
              <KV k="EVENTS BUFFERED" v={`${snap.events.length}`} />
              <KV k="TASKS TRACKED" v={`${snap.tasks.length}`} />
              <div className="mt-2">
                <div className="label mb-1">TASK VOLUME OVER TIME</div>
                <Sparkline
                  data={snap.tasks.map((t) => t.createdAt).sort((a, b) => a - b).map((_, i) => i + 1)}
                  color="#38BDF8"
                  height={40}
                  width={360}
                />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
