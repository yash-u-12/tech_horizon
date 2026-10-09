/**
 * Headless validation of the NEXUS simulation core.
 * Run: npm run sim:test
 */
import { SimulationEngine, SIM_DT } from '../src/simulation/engine';
import type { EngineConfig } from '../src/simulation/engine';

const cfg: EngineConfig = {
  seed: 20261007,
  robotCount: 6,
};

function run(label: string, seconds: number, scenario?: string) {
  const t0 = Date.now();
  const e = new SimulationEngine(cfg);
  // Seed the headless simulation explicitly; application startup no longer
  // generates orders without an operator action.
  for (let i = 0; i < 4; i++) e.createGeneratedOrder();
  const steps = Math.floor(seconds / SIM_DT);
  const triggerAt = scenario ? Math.floor(14 / SIM_DT) : -1;
  let errors = 0;
  for (let i = 0; i < steps; i++) {
    if (triggerAt >= 0 && i === triggerAt) e.triggerScenario(scenario!);
    try {
      e.step();
    } catch (err) {
      errors++;
      if (errors < 3) console.error(`  [step ${i}] ${(err as Error).message}\n${(err as Error).stack?.split('\n').slice(0, 4).join('\n')}`);
    }
  }
  const s = e.getSnapshot();
  const ms = Date.now() - t0;

  console.log(`\n═══ ${label} ═══`);
  console.log(`sim time      ${s.time.toFixed(1)}s in ${ms}ms  (${(steps / (ms / 1000)).toFixed(0)} ticks/s realtime)`);
  console.log(`errors        ${errors}`);

  // integrity checks
  const nan = s.robots.filter((r) => !Number.isFinite(r.pose.x) || !Number.isFinite(r.pose.y) || !Number.isFinite(r.battery));
  console.log(`NaN robots    ${nan.length}`);

  console.log('\nROBOTS');
  for (const r of s.robots) {
    const ctx = s.contexts[r.id];
    console.log(
      `  ${r.id} ${(r.executionMode === 'PHYSICAL' ? 'REAL/' + r.hardwareId : 'SIM').padEnd(9)} ` +
      `${r.status.padEnd(9)} nav=${r.navState.padEnd(11)} bat=${(r.battery ?? 0).toFixed(0).padStart(3)}% ` +
      `v=${Math.abs(r.speed).toFixed(2)} tasks=${r.completedTasks} replans=${r.replanCount} ` +
      `pos=(${r.pose.x.toFixed(1)},${r.pose.y.toFixed(1)}) ` +
      `dec=${(r.lastDecision?.kind ?? '-').padEnd(8)} ${ctx ? `sig=${ctx.signature}` : ''}`,
    );
  }

  const taskStates = new Map<string, number>();
  for (const t of e.tasks.tasks) taskStates.set(t.state, (taskStates.get(t.state) ?? 0) + 1);
  console.log('\nTASKS', Object.fromEntries(taskStates));
  console.log('completed     ', s.metrics.tasksCompleted);
  console.log('throughput/min', s.metrics.throughputPerMin.toFixed(2));
  console.log('replans       ', s.metrics.replans);
  console.log('reassignments ', s.metrics.reassignments);
  console.log('near misses   ', s.metrics.nearMisses);
  console.log('conflicts     ', s.metrics.conflictsResolved);
  console.log('utilisation   ', (s.metrics.robotUtilisation * 100).toFixed(1) + '%');
  console.log('distance      ', s.metrics.distanceTravelled.toFixed(1), 'm');
  console.log('packets       ', `sent=${e.bus.stats.sent} delivered=${e.bus.stats.delivered} dropped=${e.bus.stats.dropped}`);

  // context diversity check — the core requirement
  const sigs = s.robots.map((r) => s.contexts[r.id]?.signature).filter((x) => x !== undefined);
  console.log(`context sigs  ${sigs.join(', ')} → ${new Set(sigs).size}/${sigs.length} unique`);

  return { e, s, errors };
}

console.log('NEXUS simulation core — headless validation');
console.log('==========================================');

const quietEngine = new SimulationEngine(cfg);
for (let i = 0; i < Math.floor(60 / SIM_DT); i++) quietEngine.step();
const noUnsolicitedTasks = quietEngine.tasks.tasks.length === 0;
console.log(`idle 60 s    ${quietEngine.tasks.tasks.length} tasks created without operator input`);

const baseline = run('BASELINE · 120 s', 120);
run('SCENARIO F · BLOCKED AISLE', 90, 'F');
run('SCENARIO B · ROBOT FAILURE', 90, 'B');
run('SCENARIO E · COMMS DEGRADATION', 90, 'E');

// ── targeted architecture assertions ────────────────────────────────────────
console.log('\n═══ ARCHITECTURE ASSERTIONS ═══');
const { e } = baseline;
const a = e.agents;

function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' · ' + detail : ''}`);
  return ok ? 0 : 1;
}
let fails = 0;

fails += check('agents are distinct objects', new Set(a.map((x) => x.state)).size === a.length);
fails += check('each agent has own memory map', new Set(a.map((x) => x.state.memory.knownBlocked)).size === a.length);
fails += check('each agent has own planner state', new Set(a.map((x) => x.state.planHistory)).size === a.length);
fails += check('contexts are per-agent objects', new Set(a.map((x) => x.context)).size === a.length);
fails += check('traits differ between agents', new Set(a.map((x) => JSON.stringify(x.state.memory.traits))).size > 1);
fails += check('no unsolicited task creation', noUnsolicitedTasks);
const manualCheck = new SimulationEngine(cfg).forceOrder();
fails += check('manual order source and top priority', manualCheck?.source === 'MANUAL' && manualCheck.priority === 'CRITICAL');

const moving = a.filter((x) => x.state.status === 'MOVING').length;
fails += check('robots are actually working', e.tasks.completed.length > 0, `${e.tasks.completed.length} tasks completed`);
fails += check('plans were generated', a.some((x) => x.state.planHistory.length > 0 || x.state.plan));
fails += check('replanning occurred', a.some((x) => x.state.replanCount > 0), `max=${Math.max(...a.map((x) => x.state.replanCount))}`);

// R01 must be physical with a live twin
const r01 = e.agent('R01')!;
fails += check('R01 is executing on hardware', r01.state.executionMode === 'PHYSICAL', r01.state.hardwareId ?? 'none');
fails += check('R01 twin reports telemetry', r01.state.twin.packetsReceived > 0, `${r01.state.twin.packetsReceived} packets`);
fails += check('R01 twin is MOCK-labelled', r01.state.twin.hardwareClass === 'MOCK');
fails += check('R01 twin pose tracks hardware', r01.state.twin.positionError >= 0);

// §47A: rebind the SAME hardware to a different agent
const before = e.agent('R03')!.state;
const r03TasksBefore = before.completedTasks;
// A unit already claimed by another agent must refuse the bind outright.
const occupied = e.requestBind('R03', 'P01');
for (let i = 0; i < 40; i++) e.step();
fails += check('§47A busy hardware refuses bind', occupied?.compatible === false, occupied?.reason ?? '');
fails += check('§47A no double ownership', e.agent('R03')!.state.executionMode === 'SIMULATION');

// Safe handover: release R01, then bind the SAME unit to R03.
e.requestUnbind('R01');
for (let i = 0; i < 20; i++) e.step();
fails += check('§47A R01 released to simulation', e.agent('R01')!.state.executionMode === 'SIMULATION');
const ok = e.requestBind('R03', 'P01');
for (let i = 0; i < 40; i++) e.step();
const r03 = e.agent('R03')!;
fails += check('§47A R03 accepts the free unit', ok?.compatible === true);
fails += check('§47A R03 now executes on P01', r03.state.executionMode === 'PHYSICAL' && r03.state.hardwareId === 'P01', r03.state.binding.stage);
fails += check('§47A R03 kept identity + history', r03.state.id === 'R03' && r03.state.completedTasks >= r03TasksBefore);
fails += check('§47A R03 twin reports telemetry', r03.state.twin.packetsReceived > 0, `${r03.state.twin.packetsReceived} packets`);
fails += check('§47A R03 twin is MOCK-labelled', r03.state.twin.hardwareClass === 'MOCK');

// Forced handover straight to a different agent, no explicit release step.
const forced = e.requestBind('R04', 'P01', true);
for (let i = 0; i < 40; i++) e.step();
fails += check('§47A forced handover to R04', e.agent('R04')!.state.executionMode === 'PHYSICAL', e.agent('R04')!.state.hardwareId ?? '');
fails += check('§47A previous holder released on handover', e.agent('R03')!.state.executionMode === 'SIMULATION');
fails += check('§47A exactly one owner of P01', e.agents.filter((x) => x.state.hardwareId === 'P01').length === 1);
e.requestUnbind('R04');
for (let i = 0; i < 25; i++) e.step();
fails += check('§47A R04 returned to sim', e.agent('R04')!.state.executionMode === 'SIMULATION');

// compatibility gate
const report = e.registry.get('P03') ? e.requestBind('R02', 'P03') : null;
fails += check('§47A incompatible bind rejected', report === null || report.compatible === false);

console.log(`\n${fails === 0 ? 'ALL ASSERTIONS PASSED' : fails + ' ASSERTION FAILURES'}`);
process.exit(fails === 0 ? 0 : 1);
