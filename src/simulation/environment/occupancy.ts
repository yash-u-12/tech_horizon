import { GRID_CELL, GRID_D, GRID_W, WORLD, worldToCell } from '../config'
import type { Rect, Vec2, WarehouseObject } from '../../types'

/**
 * Occupancy grid shared by every agent's planner.
 *
 * The grid is *configuration space*: every footprint is inflated by the robot
 * radius, so a cell is either traversable by the whole body or not. Obstacles
 * are separated into a static layer (built once) and a dynamic layer (temporary
 * obstacles injected by scenarios), so replanning never rebuilds the world.
 */
export class OccupancyGrid {
  readonly cols = GRID_W
  readonly rows = GRID_D
  readonly cell = GRID_CELL
  private static_!: Uint8Array
  private dynamic: Uint8Array
  private version = 0

  constructor(private inflationM = 0.5) {
    this.dynamic = new Uint8Array(this.cols * this.rows)
  }

  index(c: number, r: number) {
    return r * this.cols + c
  }
  inBounds(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows
  }

  buildStatic(objects: WarehouseObject[], extraRects: { rect: Rect }[] = []) {
    const grid = new Uint8Array(this.cols * this.rows)
    const rects = [...objects.filter((o) => o.kind !== 'STATION' || true).map((o) => o.rect), ...extraRects.map((e) => e.rect)]
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const { x, z } = this.cellCenter(c, r)
        // border wall
        if (Math.abs(x) > WORLD.width / 2 - 0.7 || Math.abs(z) > WORLD.depth / 2 - 0.7) {
          grid[this.index(c, r)] = 1
          continue
        }
        for (const rect of rects) {
          if (this.rectContains(rect, x, z, this.inflationM)) {
            grid[this.index(c, r)] = 1
            break
          }
        }
      }
    }
    this.static_ = grid
    this.version++
  }

  cellCenter(c: number, r: number): Vec2 {
    return { x: (c + 0.5) * this.cell - WORLD.width / 2, z: (r + 0.5) * this.cell - WORLD.depth / 2 }
  }

  rectContains(rect: Rect, x: number, z: number, pad = 0) {
    return (
      x >= rect.x - rect.w / 2 - pad &&
      x <= rect.x + rect.w / 2 + pad &&
      z >= rect.z - rect.d / 2 - pad &&
      z <= rect.z + rect.d / 2 + pad
    )
  }

  /** inject or clear a dynamic (temporary) obstacle footprint */
  setDynamicRects(rects: Rect[]) {
    if (this.dynamic.length === this.static_.length) this.dynamic = new Uint8Array(this.cols * this.rows)
    for (const rect of rects) {
      const c0 = Math.max(0, Math.floor((rect.x - rect.w / 2 - this.inflationM + WORLD.width / 2) / this.cell))
      const c1 = Math.min(this.cols - 1, Math.ceil((rect.x + rect.w / 2 + this.inflationM + WORLD.width / 2) / this.cell))
      const r0 = Math.max(0, Math.floor((rect.z - rect.d / 2 - this.inflationM + WORLD.depth / 2) / this.cell))
      const r1 = Math.min(this.rows - 1, Math.ceil((rect.z + rect.d / 2 + this.inflationM + WORLD.depth / 2) / this.cell))
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const { x, z } = this.cellCenter(c, r)
          if (this.rectContains(rect, x, z, this.inflationM)) this.dynamic[this.index(c, r)] = 1
        }
    }
    this.version++
  }

  clearDynamic() {
    this.dynamic.fill(0)
    this.version++
  }

  /** static + dynamic */
  blocked(c: number, r: number) {
    if (!this.inBounds(c, r)) return true
    const i = this.index(c, r)
    return this.static_[i] === 1 || this.dynamic[i] === 1
  }

  blockedAt(x: number, z: number) {
    const { c, r } = worldToCell(x, z)
    return this.blocked(c, r)
  }

  /** straight-line traversability used both by the planner and the safety layer */
  lineOfSight(a: Vec2, b: Vec2, maxStep = 0.25) {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const dist = Math.hypot(dx, dz)
    const steps = Math.max(1, Math.ceil(dist / maxStep))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      if (this.blockedAt(a.x + dx * t, a.z + dz * t)) return false
    }
    return true
  }

  /** distance (metres) from a point to the nearest blocked cell, capped at max */
  clearanceAt(p: Vec2, max = 4) {
    const cellP = worldToCell(p.x, p.z)
    for (let ring = 1; ring <= max / this.cell; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue
          if (this.blocked(cellP.c + dc, cellP.r + dr)) return (ring - 1) * this.cell
        }
      }
    }
    return max
  }

  freeCells() {
    let n = 0
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (!this.blocked(c, r)) n++
    return n
  }

  getVersion() {
    return this.version
  }
}
