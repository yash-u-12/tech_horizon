/**
 * DETERMINISTIC DEMONSTRATION SCENARIOS (§35)
 *
 * Every scenario mutates the REAL simulation state — obstacles are created in
 * the occupancy grid, robots genuinely go offline, comms link quality genuinely
 * changes, batteries genuinely drain. Nothing here is a notification.
 */

import type { AgentWorld, RobotAgent } from '../agents/agent';
import type { Warehouse } from '../environment/warehouse';
import type { TaskManager } from '../tasks/taskManager';
import type { CommsBus } from '../communication/bus';
import type { HardwareRegistry } from '../robots/hardware';
import type { ScenarioDef, SimEvent } from '../types';
import type { OccupancyGrid } from '../environment/grid';
import { dist } from '../core/math';

export interface ScenarioContext {
  time: number;
  /** live engine world handle — lets scenarios drive agents directly */
  world: AgentWorld;
  warehouse: Warehouse;
  grid: OccupancyGrid;
  agents: RobotAgent[];
  tasks: TaskManager;
  bus: CommsBus;
  registry: HardwareRegistry;
  emit(e: Omit<SimEvent, 'id' | 'at'>): void;
  /** deterministic randomness — never Math.random, demos must replay exactly */
  rng(): number;
  setComms(latency: number, loss: number): void;
  restoreComms(): void;
  /** find an agent that is currently doing real work */
  busiestAgent(): RobotAgent | null;
}

export interface Scenario extends ScenarioDef {
  apply(ctx: ScenarioContext): void;
  /** reverse the effects (used when the scenario is cleared) */
  clear?(ctx: ScenarioContext): void;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'A',
    code: 'SCENARIO A',
    name: 'NORMAL OPERATION',
    description: 'Steady-state decentralised operation. Orders arrive, agents bid, winners execute.',
    demo: 'Every robot perceives, plans and acts independently with no central dispatcher.',
    severity: 'INFO',
    apply(ctx) {
      ctx.restoreComms();
      ctx.emit({ t: ctx.time, severity: 'INFO', source: 'SCENARIO', category: 'SCENARIO', message: 'SCENARIO A · NORMAL DECENTRALISED OPERATION' });
    },
  },

  {
    id: 'B',
    code: 'SCENARIO B',
    name: 'ROBOT FAILURE',
    description: 'A working agent suffers a hard fault mid-task and drops out of the fleet.',
    demo: 'The failed robot stops, its task is released, and the fleet recovers without intervention.',
    severity: 'CRITICAL',
    apply(ctx) {
      const target = ctx.busiestAgent() ?? ctx.agents[1];
      if (!target) return;
      target.state.estop = false;
      const heldTask = target.state.taskId ?? undefined;
      target.fail('HARDWARE FAULT · DRIVE CONTROLLER');
      // Release the held job back to the auction — this is the "solution": the
      // task returns to the board and the fleet reassigns it without any
      // operator intervention (the demo promise, and scenario D's drill).
      if (heldTask) {
        ctx.tasks.reQueue(heldTask, 'ROBOT FAILURE · TASK RELEASED FOR REASSIGNMENT', ctx.time);
        ctx.emit({ t: ctx.time, severity: 'WARNING', source: 'TASK', category: 'TASK', message: `${heldTask} RELEASED · ${target.state.id} OFFLINE`, taskId: heldTask, robotId: target.state.id });
      }
      // physical hardware goes with it
      const hw = target.state.hardwareId;
      if (hw) {
        const i = ctx.registry.iface(hw);
        i?.disconnect();
        const u = ctx.registry.get(hw);
        if (u) u.status = 'FAULT';
      }
      ctx.emit({ t: ctx.time, severity: 'CRITICAL', source: 'AGENT', category: 'AGENT', message: `${target.state.id} OFFLINE · DRIVE CONTROLLER FAULT`, robotId: target.state.id });
    },
    clear(ctx) {
      for (const a of ctx.agents) {
        if (a.state.status === 'OFFLINE') {
          a.recover(ctx.world);
          ctx.emit({ t: ctx.time, severity: 'SUCCESS', source: 'AGENT', category: 'AGENT', message: `${a.state.id} RECOVERED · RETURNED TO SERVICE`, robotId: a.state.id });
        }
      }
    },
  },

  {
    id: 'C',
    code: 'SCENARIO C',
    name: 'TRAFFIC CONFLICT',
    description: 'Two agents are sent head-on through the same narrow cross-aisle.',
    demo: 'Both robots independently evaluate right-of-way; the lower-priority one yields or detours.',
    severity: 'WARNING',
    apply(ctx) {
      const moving = ctx.agents.filter((a) => a.state.status !== 'OFFLINE');
      if (moving.length < 2) return;
      const A = moving[0];
      const B = moving[1];
      // send them at each other through the cross-aisle at y ≈ 15.75
      const y = 15.75;
      const aDest = { x: 6.0, y };
      const bDest = { x: 34.0, y };
      const t1 = ctx.tasks.createExplicit(ctx.time, { x: 6.0, y }, 'CONFLICT-A', { x: 34.0, y }, 'CONFLICT-B', 'HIGH', 'SCENARIO');
      const t2 = ctx.tasks.createExplicit(ctx.time, { x: 34.0, y }, 'CONFLICT-B', { x: 6.0, y }, 'CONFLICT-A', 'LOW', 'SCENARIO');
      void aDest; void bDest;
      A.assignTask(ctx.world, t1.id);
      B.assignTask(ctx.world, t2.id);
      t1.state = 'IN_PROGRESS'; t1.startedAt = ctx.time; t1.assignedTo = A.state.id;
      t2.state = 'IN_PROGRESS'; t2.startedAt = ctx.time; t2.assignedTo = B.state.id;
      ctx.emit({ t: ctx.time, severity: 'WARNING', source: 'SCENARIO', category: 'TRAFFIC', message: `TRAFFIC CONFLICT STAGED · ${A.state.id} ↔ ${B.state.id}` });
    },
  },

  {
    id: 'D',
    code: 'SCENARIO D',
    name: 'TASK REASSIGNMENT',
    description: 'The agent holding the highest-priority task is removed; the job returns to auction.',
    demo: 'Watch the task change hands, the new robot plan a fresh route, and the job complete.',
    severity: 'CRITICAL',
    apply(ctx) {
      const holder = ctx.agents
        .filter((a) => a.state.taskId && a.state.status !== 'OFFLINE')
        .sort((a, b) => priorityRank(b.state.taskPriority) - priorityRank(a.state.taskPriority))[0];
      if (!holder) return;
      const taskId = holder.state.taskId!;
      holder.fail('FORCED FAULT · REASSIGNMENT DRILL');
      ctx.tasks.reQueue(taskId, 'AGENT LOST · REASSIGNING', ctx.time);
      ctx.emit({ t: ctx.time, severity: 'CRITICAL', source: 'TASK', category: 'TASK', message: `${taskId} REASSIGNING · ${holder.state.id} REMOVED`, taskId, robotId: holder.state.id });
    },
  },

  {
    id: 'E',
    code: 'SCENARIO E',
    name: 'COMMUNICATION DEGRADATION',
    description: 'Uplink/downlink latency and packet loss spike across the fleet.',
    demo: 'Digital twins drift and go stale; agents bid on different information and disagree.',
    severity: 'WARNING',
    apply(ctx) {
      ctx.setComms(0.62, 0.34);
      ctx.emit({ t: ctx.time, severity: 'WARNING', source: 'SYSTEM', category: 'SYSTEM', message: 'COMMUNICATION DEGRADATION · 620 ms · 34% LOSS' });
    },
    clear(ctx) {
      ctx.restoreComms();
      ctx.emit({ t: ctx.time, severity: 'SUCCESS', source: 'SYSTEM', category: 'SYSTEM', message: 'COMMUNICATION RESTORED' });
    },
  },

  {
    id: 'F',
    code: 'SCENARIO F',
    name: 'BLOCKED AISLE',
    description: 'A spill closes the primary cross-aisle that most routes depend on.',
    demo: 'Robots detect the blockage with their own sensors, mark their routes invalid and replan.',
    severity: 'WARNING',
    apply(ctx) {
      const y = 15.75;
      const xs = [12.2, 15.0, 17.8, 21.4, 24.2, 27.0, 30.2];
      xs.forEach((x, i) => {
        ctx.warehouse.addObstacle({
          id: `OBS-SPILL-${i}`,
          x,
          y: y + (i % 2 === 0 ? 0.35 : -0.35),
          r: 0.95,
          kind: 'SPILL',
          createdAt: ctx.time,
          ttl: 55,
          label: 'SPILL',
        });
      });
      // agents that saw it warn their peers over the (lossy) comms channel
      for (const o of ctx.warehouse.obstacles.filter((o) => o.id.startsWith('OBS-SPILL'))) {
        ctx.bus.broadcast({ kind: 'HAZARD', from: 'ENVIRONMENT', t: ctx.time, id: o.id, x: o.x, y: o.y, r: o.r }, ctx.time);
      }
      ctx.emit({ t: ctx.time, severity: 'WARNING', source: 'ENVIRONMENT', category: 'TRAFFIC', message: 'AISLE BLOCKED · SPILL DETECTED IN CROSS-AISLE C' });
    },
    clear(ctx) {
      ctx.warehouse.clearTemporaryObstacles();
      ctx.emit({ t: ctx.time, severity: 'SUCCESS', source: 'ENVIRONMENT', category: 'TRAFFIC', message: 'AISLE CLEARED' });
    },
  },

  {
    id: 'G',
    code: 'SCENARIO G',
    name: 'LOW BATTERY',
    description: 'Fleet energy is drained to force self-initiated charging decisions.',
    demo: 'Each robot independently decides when to stop work and dock, based on its own threshold.',
    severity: 'WARNING',
    apply(ctx) {
      for (const a of ctx.agents) {
        if (a.state.status === 'OFFLINE') continue;
        a.state.battery = Math.max(8, a.state.battery * (0.28 + ctx.rng() * 0.16));
        const hw = a.state.hardwareId;
        if (hw) {
          const iface = ctx.registry.iface(hw) as any;
          if (iface?.setBattery) iface.setBattery(a.state.battery);
        }
      }
      ctx.emit({ t: ctx.time, severity: 'WARNING', source: 'FLEET', category: 'SYSTEM', message: 'FLEET ENERGY DRAINED · CHARGING BEHAVIOUR TRIGGERED' });
    },
  },

  {
    id: 'H',
    code: 'SCENARIO H',
    name: 'GENERATION CONTROL',
    description: 'Confirms that tasks are generated only after an operator starts a batch.',
    demo: 'Use Generate Tasks on the Task Page to start a five-task batch.',
    severity: 'INFO',
    apply(ctx) {
      ctx.emit({ t: ctx.time, severity: 'INFO', source: 'WMS', category: 'TASK', message: 'TASK GENERATION IS OPERATOR CONTROLLED · USE GENERATE TASKS ON THE TASK PAGE' });
    },
  },
];

function priorityRank(p: string | null) {
  return p === 'CRITICAL' ? 4 : p === 'HIGH' ? 3 : p === 'NORMAL' ? 2 : p ? 1 : 0;
}

export const SCENARIO_DEFS: ScenarioDef[] = SCENARIOS.map(({ id, code, name, description, demo, severity }) => ({
  id, code, name, description, demo, severity,
}));

/** Distance between the two closest agents — used by the traffic page. */
export function closestPair(agents: RobotAgent[]) {
  let best = { a: '', b: '', d: Infinity };
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const A = agents[i].state;
      const B = agents[j].state;
      if (A.status === 'OFFLINE' || B.status === 'OFFLINE') continue;
      const d = dist(A.pose.x, A.pose.y, B.pose.x, B.pose.y);
      if (d < best.d) best = { a: A.id, b: B.id, d };
    }
  }
  return best;
}
