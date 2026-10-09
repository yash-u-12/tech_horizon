import { SimulationEngine, SIM_DT } from '../src/simulation/engine';
import type { EngineConfig } from '../src/simulation/engine';

const cfg: EngineConfig = { seed: 20261007, robotCount: 6 };
const e = new SimulationEngine(cfg);
for (let i = 0; i < 4; i++) e.createGeneratedOrder();
const seconds = Number(process.argv[2] ?? 120);

// Track how each robot's distance-to-task-target evolves. A healthy robot shows
// a monotonic decrease; an oscillating one never converges.
const hist = new Map<string, { t: number; d: number; phase: string; taskId: string }[]>();

for (let i = 0; i < Math.floor(seconds / SIM_DT); i++) {
  e.step();
  for (const a of e.agents) {
    const s = a.state;
    if (!s.taskId) continue;
    const t = e.tasks.byId(s.taskId);
    if (!t) continue;
    const tgt = t.phase === 'TO_PICK' ? t.from : t.to;
    const d = Math.hypot(tgt.x - s.pose.x, tgt.y - s.pose.y);
    const arr = hist.get(s.id) ?? [];
    arr.push({ t: e.time, d, phase: t.phase, taskId: t.id });
    hist.set(s.id, arr);
  }
}

console.log('=== per-robot distance to task target (sampled every 5 s) ===');
for (const [id, arr] of hist) {
  const line: string[] = [];
  for (let t = 0; t <= seconds; t += 5) {
    const p = arr.find((x) => x.t >= t);
    line.push(p ? p.d.toFixed(0).padStart(3) : '  ·');
  }
  const phases = [...new Set(arr.map((a) => a.phase))].join('/');
  const tasks = [...new Set(arr.map((a) => a.taskId))].join(',');
  console.log(`${id} [${line.join(' ')}]  phases=${phases} tasks=${tasks}`);
}
console.log('\ncompleted:', e.tasks.completed.length, 'states:',
  JSON.stringify(e.tasks.tasks.reduce((m: any, t) => ((m[t.state] = (m[t.state] ?? 0) + 1), m), {})));
console.log('per-robot completed:', e.agents.map((a) => `${a.state.id}:${a.state.completedTasks}`).join(' '));
console.log('distances:', e.agents.map((a) => `${a.state.id}:${a.state.distanceTravelled.toFixed(0)}m`).join(' '));
