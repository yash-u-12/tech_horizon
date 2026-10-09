/**
 * STAGED DEPLOYMENT WIZARD (§47A.3)
 *
 *   SELECT AGENT → DEPLOY TO PHYSICAL → SELECT HARDWARE → COMPATIBILITY
 *   → SAFETY VALIDATION → CONFIRM → SYNCHRONISE → CONTROL ENABLED
 *
 * The wizard does not perform the binding — it *requests* it from the engine,
 * which owns the staged state machine (BindingController). The UI only reads
 * `robot.binding.stage` back out of the snapshot and renders it.
 */

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Cpu,
  Link2,
  Loader2,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { runtime } from '@/simulation/runtime';
import { checkCompatibility } from '@/simulation/robots/hardware';
import { useNexus } from '@/store/useNexus';
import { Bar, Chip, Dot, KV } from './ui';
import type { CompatibilityReport, HardwareStatus } from '@/simulation/types';

type StageId =
  | 'SELECT'
  | 'DEPLOY'
  | 'HARDWARE'
  | 'COMPATIBILITY'
  | 'SAFETY'
  | 'CONFIRM'
  | 'SYNCHRONISE'
  | 'ENABLED';

const STAGES: { id: StageId; label: string; hint: string }[] = [
  { id: 'SELECT', label: 'SELECT AGENT', hint: 'Choose which virtual agent to deploy' },
  { id: 'DEPLOY', label: 'DEPLOY TO PHYSICAL', hint: 'Request a physical execution backend' },
  { id: 'HARDWARE', label: 'SELECT HARDWARE', hint: 'Pick an available hardware unit' },
  { id: 'COMPATIBILITY', label: 'COMPATIBILITY CHECK', hint: 'Validate the agent against the unit' },
  { id: 'SAFETY', label: 'SAFETY VALIDATION', hint: 'Confirm command limits and e-stop path' },
  { id: 'CONFIRM', label: 'CONFIRM', hint: 'Authorise the handover' },
  { id: 'SYNCHRONISE', label: 'SYNCHRONISE', hint: 'Stop → safe state → adopt real pose' },
  { id: 'ENABLED', label: 'CONTROL ENABLED', hint: 'Physical robot is live in the fleet' },
];

const HW_TONE: Record<HardwareStatus, 'ok' | 'nav' | 'danger' | 'warn' | 'steel'> = {
  ONLINE: 'ok',
  BUSY: 'nav',
  OFFLINE: 'danger',
  FAULT: 'danger',
  ESTOP: 'danger',
};

export function BindingDialog() {
  const bindingFor = useNexus((s) => s.bindingFor);
  const closeBinding = useNexus((s) => s.closeBinding);
  const snap = useNexus((s) => s.snap);
  const notify = useNexus((s) => s.notify);
  const selectRobot = useNexus((s) => s.selectRobot);

  const [hardwareId, setHardwareId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [force, setForce] = useState(false);

  const robot = snap.robots.find((r) => r.id === bindingFor) ?? null;
  const live = robot?.binding;

  useEffect(() => {
    if (bindingFor) {
      setHardwareId(null);
      setAcknowledged(false);
      setForce(false);
    }
  }, [bindingFor]);

  const unit = hardwareId ? snap.hardware.find((h) => h.id === hardwareId) ?? null : null;

  const report: CompatibilityReport | null = useMemo(() => {
    if (!robot || !unit) return null;
    return checkCompatibility(robot.id, robot.capabilities, unit);
  }, [robot?.id, unit?.id, snap.tick]);

  // the engine drives the real state machine once the request is in flight
  const inFlight = !!live && live.stage !== 'IDLE' && live.stage !== 'ACTIVE' && live.stage !== 'ERROR';
  const done = robot?.executionMode === 'PHYSICAL';
  const failed = live?.stage === 'COMPATIBILITY_FAIL' || live?.stage === 'ERROR';

  let stage: StageId = 'SELECT';
  if (done) stage = 'ENABLED';
  else if (inFlight) {
    stage = live.stage === 'CHECKING' || live.stage === 'COMPATIBILITY_OK' ? 'SYNCHRONISE'
      : live.stage === 'SAFETY_HOLD' ? 'SAFETY'
        : live.stage === 'STOPPING' ? 'SYNCHRONISE'
          : live.stage === 'SYNCHRONISING' ? 'SYNCHRONISE'
            : live.stage === 'RELEASING' ? 'SYNCHRONISE'
              : 'SYNCHRONISE';
  } else if (failed) stage = 'COMPATIBILITY';
  else if (bindingFor) stage = hardwareId ? 'CONFIRM' : 'HARDWARE';
  else stage = 'SELECT';

  const stageIdx = STAGES.findIndex((s) => s.id === stage);

  if (!bindingFor) return null;

  const otherAgents = snap.robots.filter((r) => r.id !== bindingFor && r.executionMode === 'SIMULATION');

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-void/70 backdrop-blur-[2px]">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="flex max-h-[calc(100vh-80px)] w-[720px] flex-col overflow-hidden rounded-md border border-line2 bg-panel shadow-2xl"
      >
        {/* ── header ──────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start justify-between border-b border-line px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <Link2 size={14} className="text-nav" />
              <span className="font-['Manrope'] text-[13px] font-bold uppercase tracking-[0.14em] text-txt">
                DEPLOY AGENT TO PHYSICAL HARDWARE
              </span>
            </div>
            <div className="mt-1 text-[11px] text-txt3">
              The agent keeps its identity, context, task, plan and coordination state. Only its
              execution backend changes.
            </div>
          </div>
          <button className="btn-icon" onClick={closeBinding}>
            <X size={14} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ── stage rail ────────────────────────────────────────────────── */}
          <div className="w-[212px] shrink-0 border-r border-line bg-abyss/60 p-3">
            {STAGES.map((s, i) => {
              const state = i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'pending';
              return (
                <div key={s.id} className="flex gap-2.5 pb-3 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span
                      className={clsx(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        state === 'done' && 'border-ok/60 bg-ok/[0.16] text-ok',
                        state === 'active' && 'border-nav/70 bg-nav/[0.16] text-nav',
                        state === 'pending' && 'border-line2 text-txt3',
                      )}
                    >
                      {state === 'done' ? (
                        <CheckCircle2 size={10} />
                      ) : state === 'active' && inFlight ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <span className="text-[7px] font-bold">{i + 1}</span>
                      )}
                    </span>
                    {i < STAGES.length - 1 && (
                      <span
                        className={clsx('mt-0.5 w-px flex-1', i < stageIdx ? 'bg-ok/40' : 'bg-line2')}
                      />
                    )}
                  </div>
                  <div className="min-w-0 pb-1">
                    <div
                      className={clsx(
                        'text-2xs font-semibold uppercase tracking-[0.1em]',
                        state === 'done' ? 'text-ok' : state === 'active' ? 'text-nav' : 'text-txt3',
                      )}
                    >
                      {s.label}
                    </div>
                    <div className="mt-0.5 text-3xs leading-tight text-txt3">{s.hint}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── body ──────────────────────────────────────────────────────── */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {/* ── agent identity ──────────────────────────────────────────── */}
            {robot && (
              <div className="mb-4 rounded border border-line2 bg-abyss/50 p-3">
                <div className="flex items-center gap-2">
                  <Cpu size={12} className="text-txt3" />
                  <span className="label">AGENT</span>
                  <span className="mono ml-1 text-[14px] font-semibold text-txt">{robot.id}</span>
                  <Chip tone="steel">{robot.executionMode === 'PHYSICAL' ? `PHYSICAL ${robot.hardwareId}` : 'SIMULATED'}</Chip>
                  <span className="ml-auto mono text-3xs text-txt3">
                    {robot.taskId ? `CARRYING TASK ${robot.taskId}` : 'NO TASK'}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4">
                  <KV k="DRIVE" v={robot.capabilities.drive} />
                  <KV k="MAX V" v={`${robot.capabilities.maxVelocity.toFixed(2)} m/s`} />
                  <KV k="PAYLOAD" v={`${robot.capabilities.payloadKg} kg`} />
                  <KV k="LIDAR" v={robot.capabilities.lidar ? 'YES' : 'NO'} tone={robot.capabilities.lidar ? 'ok' : 'warn'} />
                  <KV k="SENSOR RANGE" v={`${robot.capabilities.sensorRange.toFixed(1)} m`} />
                  <KV k="TURN RADIUS" v={`${robot.capabilities.turningRadius.toFixed(2)} m`} />
                </div>
                <div className="mt-2 border-t border-line/60 pt-1.5 text-3xs leading-tight text-txt3">
                  Identity, task assignment, planner state, perception history and peer model are all
                  preserved across the handover.
                </div>
              </div>
            )}

            {/* ── hardware selection ──────────────────────────────────────── */}
            {!inFlight && !done && (
              <>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="label">AVAILABLE HARDWARE</span>
                  <span className="text-3xs text-txt3">eligibility is computed, never assumed</span>
                </div>
                <div className="grid gap-1.5">
                  {snap.hardware.map((h) => {
                    const busy = !!h.boundTo;
                    const sel = hardwareId === h.id;
                    const compat = robot ? checkCompatibility(robot.id, robot.capabilities, h) : null;
                    const eligible = !!compat?.compatible;
                    return (
                      <button
                        key={h.id}
                        onClick={() => setHardwareId(h.id)}
                        className={clsx(
                          'rounded border p-2.5 text-left transition-colors',
                          sel ? 'border-nav/60 bg-nav/10' : 'border-line2 bg-abyss/40 hover:border-steel/60',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="mono text-[13px] font-semibold text-txt">{h.id}</span>
                          <span className="text-2xs text-txt2">{h.name}</span>
                          <Chip tone={HW_TONE[h.status]}>{h.status}</Chip>
                          {h.mock && <Chip tone="warn">MOCK</Chip>}
                          {busy && <Chip tone="nav">BOUND TO {h.boundTo}</Chip>}
                          <span className="mono ml-auto text-3xs text-txt3">{h.transport}</span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-4 gap-x-3">
                          <KV k="MODEL" v={h.model} />
                          <KV k="MAX V" v={`${h.capabilities.maxVelocity.toFixed(2)}`} />
                          <KV k="PAYLOAD" v={`${h.capabilities.payloadKg} kg`} />
                          <KV k="LIDAR" v={h.capabilities.lidar ? 'YES' : 'NO'} tone={h.capabilities.lidar ? 'ok' : 'warn'} />
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-3xs uppercase tracking-[0.1em] text-txt3">BATTERY</span>
                          <div className="w-24">
                            <Bar value={h.battery} tone={h.battery > 30 ? 'ok' : 'warn'} />
                          </div>
                          <span className="mono text-3xs text-txt2">{h.battery.toFixed(0)}%</span>
                          <span className="mono ml-auto text-3xs text-txt3">{h.endpoint}</span>
                        </div>
                        {compat && (
                          <div className="mt-1.5 flex items-center gap-1.5 border-t border-line/60 pt-1.5">
                            {eligible ? (
                              <span className="flex items-center gap-1 text-3xs font-semibold uppercase tracking-[0.1em] text-ok">
                                <CheckCircle2 size={10} /> COMPATIBLE · {compat.score.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-3xs font-semibold uppercase tracking-[0.1em] text-danger">
                                <XCircle size={10} /> INCOMPATIBLE · {compat.reason}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── compatibility matrix ────────────────────────────────────── */}
            {report && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="label">COMPATIBILITY MATRIX</span>
                  <span className={clsx('ml-auto mono text-2xs font-semibold', report.compatible ? 'text-ok' : 'text-danger')}>
                    {report.compatible ? 'PASS' : 'FAIL'} · {report.score.toFixed(0)}%
                  </span>
                </div>
                <div className="overflow-hidden rounded border border-line2">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-abyss/70">
                        <th className="th text-left">CHECK</th>
                        <th className="th text-right">REQUIRED</th>
                        <th className="th text-right">AVAILABLE</th>
                        <th className="th text-center">RESULT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.checks.map((c) => (
                        <tr key={c.key} className="border-t border-line/50">
                          <td className="px-2 py-[3px] text-[11px] text-txt2">{c.label}</td>
                          <td className="mono px-2 py-[3px] text-right text-[10px] text-txt3">{c.required}</td>
                          <td className="mono px-2 py-[3px] text-right text-[10px] text-txt2">{c.available}</td>
                          <td className="px-2 py-[3px] text-center">
                            {c.pass ? (
                              <CheckCircle2 size={11} className="mx-auto text-ok" />
                            ) : (
                              <XCircle size={11} className="mx-auto text-danger" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!report.compatible && (
                  <div className="mt-2 flex items-start gap-2 rounded border border-danger/40 bg-danger/[0.08] p-2">
                    <AlertTriangle size={12} className="mt-[1px] shrink-0 text-danger" />
                    <div className="text-[11px] leading-snug text-txt2">
                      <b className="text-danger">{report.reason}</b> — this agent cannot execute on{' '}
                      {report.hardwareId}. Deployment is blocked by the compatibility gate, not by a
                      hard-coded robot id.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── safety validation ───────────────────────────────────────── */}
            {report?.compatible && !done && (
              <div className="mt-3">
                <div className="label mb-1.5">SAFETY VALIDATION</div>
                <div className="rounded border border-line2 bg-abyss/40 p-2.5">
                  {[
                    'Command limits will be clamped to the hardware envelope (v, ω, accel).',
                    'E-STOP remains hardware-side and can never be overridden by the agent.',
                    'Out-of-envelope commands are rejected and counted, not silently applied.',
                    'The agent is placed in STOP + SAFE STATE before the backend is swapped.',
                    'Physical telemetry becomes authoritative for the digital twin.',
                  ].map((t, i) => (
                    <div key={i} className="flex items-start gap-2 py-[2px]">
                      <ShieldAlert size={10} className="mt-[2px] shrink-0 text-warn" />
                      <span className="text-[11px] leading-snug text-txt2">{t}</span>
                    </div>
                  ))}
                </div>
                {unit?.boundTo && (
                  <div className="mt-2 rounded border border-warn/40 bg-warn/[0.08] p-2">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={force}
                        onChange={(e) => setForce(e.target.checked)}
                        className="mt-[3px] h-3 w-3 accent-[#FBBF24]"
                      />
                      <span className="text-[11px] leading-snug text-txt2">
                        <b className="text-warn">FORCE HANDOVER.</b> {unit.id} is currently bound to{' '}
                        <b className="mono">{unit.boundTo}</b>. A forced handover stops that agent,
                        returns it to the simulation backend, and surrenders the unit. Its task goes
                        back to the auction.
                      </span>
                    </label>
                  </div>
                )}
                <label className="mt-2 flex cursor-pointer items-start gap-2 rounded border border-line2 p-2">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-[3px] h-3 w-3 accent-[#38BDF8]"
                  />
                  <span className="text-[11px] leading-snug text-txt2">
                    I authorise handing motor control of <b className="mono">{unit?.id}</b> to agent{' '}
                    <b className="mono">{robot?.id}</b>.
                  </span>
                </label>
              </div>
            )}

            {/* ── live staging ────────────────────────────────────────────── */}
            <AnimatePresence>
              {(inFlight || done || failed) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 overflow-hidden"
                >
                  <div
                    className={clsx(
                      'rounded border p-3',
                      done ? 'border-ok/40 bg-ok/[0.08]'
                        : failed ? 'border-danger/40 bg-danger/[0.08]'
                          : 'border-nav/40 bg-nav/[0.08]',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {done ? (
                        <CheckCircle2 size={13} className="text-ok" />
                      ) : failed ? (
                        <XCircle size={13} className="text-danger" />
                      ) : (
                        <Loader2 size={13} className="animate-spin text-nav" />
                      )}
                      <span
                        className={clsx(
                          'text-2xs font-bold uppercase tracking-[0.14em]',
                          done ? 'text-ok' : failed ? 'text-danger' : 'text-nav',
                        )}
                      >
                        {done ? 'CONTROL ENABLED' : failed ? 'DEPLOYMENT BLOCKED' : live?.stage}
                      </span>
                      <span className="mono ml-auto text-3xs text-txt3">
                        {live?.progress != null ? `${(live.progress * 100).toFixed(0)}%` : ''}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Bar
                        value={(live?.progress ?? 0) * 100}
                        tone={done ? 'ok' : failed ? 'danger' : 'nav'}
                        height={4}
                      />
                    </div>
                    <div className="mt-2 text-[11px] leading-snug text-txt2">{live?.message}</div>
                    {(live?.rejectedCommands ?? 0) > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-3xs text-warn">
                        <ShieldAlert size={10} />
                        {live!.rejectedCommands} COMMAND(S) REFUSED BY SAFETY · {live?.lastRejection}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── transfer to another agent ───────────────────────────────── */}
            {done && (
              <div className="mt-3">
                <div className="label mb-1.5">TRANSFER CONTROL TO ANOTHER AGENT</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {otherAgents.map((a) => (
                    <button
                      key={a.id}
                      className="btn justify-start"
                      onClick={() => {
                        runtime.engine.requestUnbind(bindingFor!);
                        runtime.engine.requestBind(a.id, robot!.hardwareId!, true);
                        notify(`TRANSFERRING ${robot!.hardwareId} FROM ${bindingFor} TO ${a.id}`, 'WARNING');
                        selectRobot(a.id);
                        useNexus.getState().openBinding(a.id);
                      }}
                    >
                      <Dot tone="nav" />
                      {a.id}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── footer ──────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5">
          {done ? (
            <>
              <button
                className="btn btn-danger"
                onClick={() => {
                  runtime.engine.requestUnbind(bindingFor!);
                  notify(`RELEASING ${robot?.hardwareId} FROM ${bindingFor} · SAFE STATE FIRST`, 'WARNING');
                }}
              >
                UNBIND AND RETURN TO SIMULATION
              </button>
              <div className="flex-1" />
              <button className="btn btn-ok" onClick={closeBinding}>
                CLOSE
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={closeBinding}>
                {inFlight ? 'CLOSE' : 'CANCEL'}
              </button>
              <div className="flex-1" />
              {!inFlight && (
                <button
                  className="btn btn-primary"
                  disabled={!hardwareId || !report?.compatible || !acknowledged}
                  onClick={() => {
                    runtime.engine.requestBind(bindingFor!, hardwareId!, force);
                    notify(`DEPLOYING ${bindingFor} ON ${hardwareId}`, 'INFO');
                  }}
                >
                  <Link2 size={12} />
                  AUTHORISE DEPLOYMENT
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
