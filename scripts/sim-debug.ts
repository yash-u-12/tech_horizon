import { SimulationEngine, SIM_DT } from '../src/simulation/engine';
import type { EngineConfig } from '../src/simulation/engine';

const cfg: EngineConfig = { seed: 20261007, robotCount: 6 };
const e = new SimulationEngine(cfg);
for (let i = 0; i < 4; i++) e.createGeneratedOrder();
const traceId = process.argv[2] ?? 'R01';
const seconds = Number(process.argv[3] ?? 60);

const agent = e.agent(traceId)!;
let lastPos = { x: agent.state.pose.x, y: agent.state.pose.y };
let travelled = 0;

for (let i = 0; i < Math.floor(seconds / SIM_DT); i++) {
  e.step();
  const s = agent.state;
  travelled += Math.hypot(s.pose.x - lastPos.x, s.pose.y - lastPos.y);
  lastPos = { x: s.pose.x, y: s.pose.y };
  const d = s.lastDecision;
  const task = s.taskId ? e.tasks.byId(s.taskId) : undefined;
  if (i % 15 === 0) {
    const dest = s.destination;
    const dd = dest ? Math.hypot(dest.x - s.pose.x, dest.y - s.pose.y) : -1;
    console.log(
      `t=${e.time.toFixed(1).padStart(5)} ${s.status.padEnd(9)}/${s.navState.padEnd(10)} ` +
      `v=${s.speed.toFixed(2)} thr=${(agent as any).throttle?.toFixed?.(2)} ` +
      `pos=(${s.pose.x.toFixed(1)},${s.pose.y.toFixed(1)}) ` +
      `task=${task ? `${task.id}/${task.phase}pri=${task.priority}` : '—'} ` +
      `dest=${dest ? `${s.destinationLabel}@${dd.toFixed(2)}m` : '—'} ` +
      `plan=${s.plan ? `${s.plan.points.length}pts c=${s.plan.cursor} cost=${s.plan.cost.toFixed(1)}` : 'NONE'} ` +
      `done=${s.completedTasks} ${d ? `${d.kind}: ${d.reason.slice(0, 40)}` : ''}`,
    );
  }
}
console.log(`\n${traceId} travelled ${travelled.toFixed(1)} m in ${seconds}s → avg ${(travelled / seconds).toFixed(3)} m/s`);
console.log('fleet completed tasks:', e.tasks.completed.length);
