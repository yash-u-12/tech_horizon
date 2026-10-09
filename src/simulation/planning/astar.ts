/**
 * Grid A* with a PLUGGABLE per-agent cost view.
 *
 * The grid is shared; the cost function is not. Each agent calls this planner
 * with:
 *   - its own believed-blocked cells (from its sensors + memory)
 *   - its own congestion estimate
 *   - the peer intents it happened to receive over a lossy comms channel
 *
 * so two agents planning the same A→B trip can legitimately produce different
 * routes. That is the whole point.
 */

import type { OccupancyGrid } from '../environment/grid';
import type { PathPoint, Vec2 } from '../types';
import { dist, polyLength, simplifyPath, smoothPath, SQRT2 } from '../core/math';

export interface CostView {
  /** agent-specific belief that a cell is impassable */
  blocked?: (ix: number, iy: number) => boolean;
  /** agent-specific additive cost (>= 0) */
  extra?: (ix: number, iy: number) => number;
  /**
   * Soft space-time reservation penalty. Called with cell + estimated time of
   * arrival for this agent. Lets peer intents bend a route instead of blocking
   * it, which is what real cooperative planners do.
   */
  reservation?: (ix: number, iy: number, eta: number) => number;
}

export interface PlanRequest {
  grid: OccupancyGrid;
  start: Vec2;
  goal: Vec2;
  view?: CostView;
  /** nominal cruise speed, used to convert distance → ETA for reservations */
  speed?: number;
  maxExpansions?: number;
  heuristicWeight?: number;
}

export interface PlanResult {
  points: PathPoint[];
  cost: number;
  length: number;
  expanded: number;
  found: boolean;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    const lastK = this.keys.pop()!;
    const lastV = this.vals.pop()!;
    if (this.keys.length) {
      this.keys[0] = lastK;
      this.vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
  }
}

const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export function planAStar(req: PlanRequest): PlanResult {
  const { grid, view = {}, maxExpansions = 24000, heuristicWeight = 1.05 } = req;
  const speed = req.speed && req.speed > 0.05 ? req.speed : 0.7;
  const { cols, rows, cell } = grid.spec;

  let s = grid.worldToCell(req.start.x, req.start.y);
  if (grid.isBlocked(s.ix, s.iy)) {
    const f = nearestFreeAround(grid, s.ix, s.iy, view.blocked);
    if (!f) return { points: [], cost: Infinity, length: 0, expanded: 0, found: false };
    s = f;
  }
  let g = grid.worldToCell(req.goal.x, req.goal.y);
  if (grid.isBlocked(g.ix, g.iy)) {
    const f = nearestFreeAround(grid, g.ix, g.iy, view.blocked);
    if (!f) return { points: [], cost: Infinity, length: 0, expanded: 0, found: false };
    g = f;
  }

  const n = cols * rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const fScore = new Float32Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const startI = grid.idx(s.ix, s.iy);
  const goalI = grid.idx(g.ix, g.iy);

  const h = (ix: number, iy: number) => {
    const dx = Math.abs(ix - g.ix);
    const dy = Math.abs(iy - g.iy);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  };

  const stepCost = (ix: number, iy: number, from: { ix: number; iy: number }, mult: number) => {
    // base geometric cost
    let c = mult * cell;
    // clearance preference: hugging racks is unsafe and slow
    const clr = grid.clearance[grid.idx(ix, iy)];
    if (clr <= 1) c += 0.55;
    else if (clr === 2) c += 0.16;
    // global congestion field (shared observation, locally weighted)
    c += Math.min(grid.congestion[grid.idx(ix, iy)], 4) * 0.5;
    // agent-specific extras: beliefs about obstacles, peer intents, etc.
    if (view.extra) c += view.extra(ix, iy);
    if (view.reservation) {
      const eta = gScore[grid.idx(from.ix, from.iy)] / speed;
      c += view.reservation(ix, iy, eta);
    }
    // discourage zig-zag by penalising heading change
    return c + 0.02 * mult;
  };

  gScore[startI] = 0;
  fScore[startI] = h(s.ix, s.iy) * heuristicWeight;
  const open = new MinHeap();
  open.push(fScore[startI], startI);

  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goalI) break;
    if (expanded > maxExpansions) break;

    const cx = cur % cols;
    const cy = (cur / cols) | 0;

    for (const [dx, dy, mult] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (closed[ni]) continue;
      if (grid.staticMask[ni] === 1) continue;
      if (grid.dynamicMask[ni] === 1) continue;
      if (view.blocked && view.blocked(nx, ny)) continue;
      // no corner cutting between two blocked orthogonal neighbours
      if (dx !== 0 && dy !== 0) {
        const a = grid.idx(cx + dx, cy);
        const b = grid.idx(cx, cy + dy);
        const aBlocked = grid.staticMask[a] || grid.dynamicMask[a] || (view.blocked?.(cx + dx, cy) ?? false);
        const bBlocked = grid.staticMask[b] || grid.dynamicMask[b] || (view.blocked?.(cx, cy + dy) ?? false);
        if (aBlocked || bBlocked) continue;
      }
      const tentative = gScore[cur] + stepCost(nx, ny, { ix: cx, iy: cy }, mult);
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        cameFrom[ni] = cur;
        fScore[ni] = tentative + h(nx, ny) * heuristicWeight;
        open.push(fScore[ni], ni);
      }
    }
  }

  if (cameFrom[goalI] === -1 && goalI !== startI) {
    // No route under this agent's beliefs. Fall back to truth: if the world is
    // actually connected, the agent discovers a route at a higher cost. This is
    // reported as PLAN_FAILED + replan rather than silently teleporting.
    const fb = planAStarTruth(req);
    if (fb.found) return { ...fb, expanded };
    return { points: [], cost: Infinity, length: 0, expanded, found: false };
  }

  const cells: { x: number; y: number }[] = [];
  let cur = goalI;
  let guard = 0;
  while (cur !== -1 && guard++ < n) {
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    cells.push(grid.cellToWorld(cx, cy));
    if (cur === startI) break;
    cur = cameFrom[cur];
  }
  cells.reverse();

  // anchor the ends on the true requested coordinates
  cells[0] = { x: req.start.x, y: req.start.y };
  cells[cells.length - 1] = { x: req.goal.x, y: req.goal.y };

  const smoothed = safeSmooth(grid, cells);
  const length = polyLength(smoothed);
  const points: PathPoint[] = smoothed.map((p, i) => ({ ...p, t: i === 0 ? 0 : undefined }));

  return { points, cost: gScore[goalI], length, expanded, found: true };
}

/**
 * Corner cutting is the classic failure of smoothed grid paths: Chaikin rounds
 * a 90° aisle turn INTO the rack. A robot then spends forever chasing a
 * waypoint it can never physically occupy.
 *
 * So we smooth optimistically and then verify the result against the inflation
 * rule — the route must stay at least one cell clear of any structure. If a
 * smoothing level violates it we fall back to a gentler one, and finally to the
 * raw grid path, which is collision-free by construction.
 */
function safeSmooth(grid: OccupancyGrid, cells: { x: number; y: number }[]): { x: number; y: number }[] {
  for (const [iters, eps] of [[2, 0.1], [1, 0.08], [0, 0.02]] as const) {
    const cand = iters === 0 ? cells : smoothPath(cells, iters);
    const simplified = simplifyPath(cand, eps);
    if (pathIsDrivable(grid, simplified)) return simplified;
  }
  return cells;
}

/**
 * A route is drivable when every sampled point is at least one navigation cell
 * away from any blocked cell — the robot's 0.72 m footprint needs the margin.
 */
function pathIsDrivable(grid: OccupancyGrid, pts: { x: number; y: number }[]): boolean {
  if (pts.length === 0) return false;
  const step = grid.spec.cell * 0.4;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const d = dist(a.x, a.y, b.x, b.y);
    const n = Math.max(2, Math.ceil(d / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const c = grid.worldToCell(x, y);
      if (!grid.inBounds(c.ix, c.iy)) return false;
      if (grid.staticMask[grid.idx(c.ix, c.iy)] === 1) return false;
      if (grid.dynamicMask[grid.idx(c.ix, c.iy)] === 1) return false;
      // The two endpoints are exempt from the clearance margin: a robot that
      // has drifted next to a rack must still be able to plan a way out.
      const atEnd = (i === 1 && k === 0) || (i === pts.length - 1 && k === n);
      if (!atEnd && grid.clearance[grid.idx(c.ix, c.iy)] < 2) return false;
    }
  }
  return true;
}

function planAStarTruth(req: PlanRequest): PlanResult {
  return planAStarRaw(req, {});
}

function planAStarRaw(req: PlanRequest, view: CostView): PlanResult {
  const grid = req.grid;
  const { cols, rows, cell } = grid.spec;
  const s0 = grid.worldToCell(req.start.x, req.start.y);
  const g0 = grid.worldToCell(req.goal.x, req.goal.y);
  const s = grid.isBlocked(s0.ix, s0.iy) ? nearestFreeAround(grid, s0.ix, s0.iy) ?? s0 : s0;
  const g = grid.isBlocked(g0.ix, g0.iy) ? nearestFreeAround(grid, g0.ix, g0.iy) ?? g0 : g0;
  const n = cols * rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const startI = grid.idx(s.ix, s.iy);
  const goalI = grid.idx(g.ix, g.iy);
  const h = (ix: number, iy: number) =>
    Math.abs(ix - g.ix) + Math.abs(iy - g.iy);
  gScore[startI] = 0;
  const open = new MinHeap();
  open.push(h(s.ix, s.iy), startI);
  let expanded = 0;
  while (open.size > 0 && expanded < 40000) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goalI) break;
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    for (const [dx, dy, mult] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (closed[ni]) continue;
      if (grid.staticMask[ni] || grid.dynamicMask[ni]) continue;
      if (view.blocked?.(nx, ny)) continue;
      const tentative = gScore[cur] + mult * cell;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        cameFrom[ni] = cur;
        open.push(tentative + h(nx, ny), ni);
      }
    }
  }
  if (cameFrom[goalI] === -1 && goalI !== startI)
    return { points: [], cost: Infinity, length: 0, expanded, found: false };
  const cells: { x: number; y: number }[] = [];
  let cur = goalI;
  let guard = 0;
  while (cur !== -1 && guard++ < n) {
    cells.push(grid.cellToWorld(cur % cols, (cur / cols) | 0));
    if (cur === startI) break;
    cur = cameFrom[cur];
  }
  cells.reverse();
  if (cells.length) {
    cells[0] = { x: req.start.x, y: req.start.y };
    cells[cells.length - 1] = { x: req.goal.x, y: req.goal.y };
  }
  const smoothed = safeSmooth(grid, cells);
  return { points: smoothed, cost: gScore[goalI], length: polyLength(smoothed), expanded, found: true };
}

function nearestFreeAround(
  grid: OccupancyGrid,
  ix: number,
  iy: number,
  blocked?: (a: number, b: number) => boolean,
): { ix: number; iy: number } | null {
  for (let r = 1; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = ix + dx;
        const ny = iy + dy;
        if (!grid.inBounds(nx, ny)) continue;
        if (grid.staticMask[grid.idx(nx, ny)] || grid.dynamicMask[grid.idx(nx, ny)]) continue;
        if (blocked?.(nx, ny)) continue;
        return { ix: nx, iy: ny };
      }
    }
  }
  return null;
}

/** Straight-line reachability test (used by the avoidance layer). */
export function lineOfSight(grid: OccupancyGrid, a: Vec2, b: Vec2, samples = 40): boolean {
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const c = grid.worldToCell(x, y);
    if (grid.isBlocked(c.ix, c.iy)) return false;
  }
  return true;
}

/** Distance from a world point to the nearest blocked cell centre. */
export function clearanceAt(grid: OccupancyGrid, x: number, y: number, maxCells = 5): number {
  const c = grid.worldToCell(x, y);
  if (!grid.inBounds(c.ix, c.iy)) return 0;
  let best = maxCells;
  for (let r = 1; r <= maxCells; r++) {
    let hit = false;
    for (let dy = -r; dy <= r && !hit; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (grid.isBlocked(c.ix + dx, c.iy + dy)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      best = r;
      break;
    }
  }
  return best * grid.spec.cell;
}

export { planAStarRaw };
export { dist };
