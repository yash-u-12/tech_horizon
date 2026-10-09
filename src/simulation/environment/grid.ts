/**
 * Occupancy grid + clearance field for the shared warehouse.
 *
 * The grid is GLOBAL state: the physical truth of what space is walkable.
 * Individual agents never read it directly — they read their own perceived
 * copy (see perception/perception.ts) which may be stale, partial or wrong.
 */

export const CELL = 0.5; // metres per cell

export interface GridSpec {
  cols: number;
  rows: number;
  width: number; // metres
  height: number; // metres
  cell: number;
}

export class OccupancyGrid {
  readonly spec: GridSpec;
  /** 1 = permanently blocked structure */
  readonly staticMask: Uint8Array;
  /** 1 = temporarily blocked (dynamic obstacle) */
  readonly dynamicMask: Uint8Array;
  /** clearance in cells to nearest static obstacle (for cost shaping) */
  readonly clearance: Float32Array;
  /** soft congestion cost accumulated from recent traffic (0..N) */
  readonly congestion: Float32Array;
  /** zone index per cell, -1 = none */
  readonly zoneIndex: Int16Array;

  private congestionDecay = 0.985;

  constructor(width: number, height: number, cell = CELL) {
    const cols = Math.round(width / cell);
    const rows = Math.round(height / cell);
    this.spec = { cols, rows, width: cols * cell, height: rows * cell, cell };
    const n = cols * rows;
    this.staticMask = new Uint8Array(n);
    this.dynamicMask = new Uint8Array(n);
    this.clearance = new Float32Array(n);
    this.congestion = new Float32Array(n);
    this.zoneIndex = new Int16Array(n).fill(-1);
  }

  get size() {
    return this.spec.cols * this.spec.rows;
  }

  idx(ix: number, iy: number) {
    return iy * this.spec.cols + ix;
  }

  inBounds(ix: number, iy: number) {
    return ix >= 0 && iy >= 0 && ix < this.spec.cols && iy < this.spec.rows;
  }

  cellToWorld(ix: number, iy: number): { x: number; y: number } {
    const c = this.spec.cell;
    return { x: (ix + 0.5) * c, y: (iy + 0.5) * c };
  }

  worldToCell(x: number, y: number): { ix: number; iy: number } {
    const c = this.spec.cell;
    return { ix: Math.floor(x / c), iy: Math.floor(y / c) };
  }

  isBlocked(ix: number, iy: number) {
    if (!this.inBounds(ix, iy)) return true;
    const i = this.idx(ix, iy);
    return this.staticMask[i] === 1 || this.dynamicMask[i] === 1;
  }

  /** Block an axis-aligned world rectangle. */
  blockRect(x: number, y: number, w: number, h: number, dynamic = false) {
    const { cell } = this.spec;
    const ix0 = Math.max(0, Math.floor(x / cell));
    const iy0 = Math.max(0, Math.floor(y / cell));
    const ix1 = Math.min(this.spec.cols - 1, Math.ceil((x + w) / cell) - 1);
    const iy1 = Math.min(this.spec.rows - 1, Math.ceil((y + h) / cell) - 1);
    const mask = dynamic ? this.dynamicMask : this.staticMask;
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) mask[this.idx(ix, iy)] = 1;
    }
  }

  /** Tag cells with a zone id for semantic "you are in X" context. */
  tagZone(x: number, y: number, w: number, h: number, zoneIdx: number) {
    const { cell } = this.spec;
    const ix0 = Math.max(0, Math.floor(x / cell));
    const iy0 = Math.max(0, Math.floor(y / cell));
    const ix1 = Math.min(this.spec.cols - 1, Math.ceil((x + w) / cell) - 1);
    const iy1 = Math.min(this.spec.rows - 1, Math.ceil((y + h) / cell) - 1);
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) this.zoneIndex[this.idx(ix, iy)] = zoneIdx;
  }

  clearDynamic() {
    this.dynamicMask.fill(0);
  }

  blockCircle(cx: number, cy: number, r: number) {
    const { cell } = this.spec;
    const ix0 = Math.max(0, Math.floor((cx - r) / cell));
    const iy0 = Math.max(0, Math.floor((cy - r) / cell));
    const ix1 = Math.min(this.spec.cols - 1, Math.ceil((cx + r) / cell) - 1);
    const iy1 = Math.min(this.spec.rows - 1, Math.ceil((cy + r) / cell) - 1);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const p = this.cellToWorld(ix, iy);
        const dx = p.x - cx;
        const dy = p.y - cy;
        if (dx * dx + dy * dy <= r * r) this.dynamicMask[this.idx(ix, iy)] = 1;
      }
    }
  }

  addCongestion(ix: number, iy: number, amount: number) {
    if (!this.inBounds(ix, iy)) return;
    this.congestion[this.idx(ix, iy)] += amount;
  }

  decayCongestion() {
    const c = this.congestion;
    for (let i = 0; i < c.length; i++) c[i] *= this.congestionDecay;
  }

  /** Multi-source BFS producing a Chebyshev-ish clearance map. */
  computeClearance(maxCells = 6) {
    const { cols, rows } = this.spec;
    const dist = this.clearance;
    dist.fill(maxCells);
    const queue: number[] = [];
    for (let i = 0; i < this.size; i++) {
      if (this.staticMask[i] === 1) {
        dist[i] = 0;
        queue.push(i);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % cols;
      const cy = (cur / cols) | 0;
      const d = dist[cur];
      if (d >= maxCells) continue;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (dist[ni] > d + 1) {
          dist[ni] = d + 1;
          queue.push(ni);
        }
      }
    }
  }
}
