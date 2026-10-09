import type { Path, PathPoint, Vec2 } from '../../types'
import { worldToCell } from '../config'
import { OccupancyGrid } from '../environment/occupancy'
import { aStar, cellsToWorld } from './astar'

/**
 * Never plan to or from a cell the body cannot occupy: targets that land inside
 * an inflated footprint are nudged to the nearest traversable cell.
 */
export function snapToFree(grid: OccupancyGrid, p: Vec2, maxRings = 6): Vec2 {
  const { c, r } = worldToCell(p.x, p.z)
  if (!grid.blocked(c, r)) return { ...p }
  for (let ring = 1; ring <= maxRings; ring++) {
    let best: { c: number; r: number; d: number } | null = null
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue
        const nc = c + dc
        const nr = r + dr
        if (grid.blocked(nc, nr)) continue
        const w = grid.cellCenter(nc, nr)
        const d = Math.hypot(w.x - p.x, w.z - p.z)
        if (!best || d < best.d) best = { c: nc, r: nr, d }
      }
    }
    if (best) return grid.cellCenter(best.c, best.r)
  }
  return { ...p }
}

export interface PlanRequest {
  id: string
  start: Vec2
  goal: Vec2
  grid: OccupancyGrid
  maxVelocity: number
  maxAccel: number
  costField?: Float32Array | null
  forbid?: ((c: number, r: number) => boolean) | null
  origin: Path['origin']
  version: number
  now: number
}

/**
 * Plan -> simplify (string pulling) -> resample with curvature-aware velocity
 * ceilings. Every planned point carries the velocity the body is allowed to
 * hold there, which is what the motion controller and the safety layer consume.
 */
export function planPath(req: PlanRequest): Path | null {
  const goal = snapToFree(req.grid, req.goal)
  const start = snapToFree(req.grid, req.start)
  const res = aStar(req.grid, start, goal, { costField: req.costField ?? null, forbid: req.forbid ?? null })
  if (!res.success) return null
  const raw = cellsToWorld(req.grid, res.cells)
  const simplified = stringPull(raw, req.grid, start)
  return buildPath({ ...req, goal }, simplified)
}

/** remove redundant waypoints using line-of-sight shortcuts */
export function stringPull(pts: Vec2[], grid: OccupancyGrid, start: Vec2): Vec2[] {
  const line = [start, ...pts]
  if (line.length <= 2) return line
  const out: Vec2[] = [line[0]]
  let i = 0
  while (i < line.length - 1) {
    let j = line.length - 1
    while (j > i + 1 && !grid.lineOfSight(line[i], line[j], 0.3)) j--
    out.push(line[j])
    i = j
  }
  return out
}

export function buildPath(req: PlanRequest, waypoints: Vec2[]): Path {
  // densify: subdivide long segments so the controller has a continuous rail
  const dense: Vec2[] = []
  const MAX_SEG = 0.6
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    const d = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.max(1, Math.ceil(d / MAX_SEG))
    for (let k = 0; k < n; k++) {
      const t = k / n
      dense.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
    }
  }
  dense.push(waypoints[waypoints.length - 1])

  const points: PathPoint[] = dense.map((p, i) => {
    const prev = dense[Math.max(0, i - 1)]
    const next = dense[Math.min(dense.length - 1, i + 1)]
    const vmax = curvatureSpeed(prev, p, next, req.maxVelocity, req.maxAccel)
    return { x: p.x, z: p.z, vmax }
  })

  let lengthM = 0
  for (let i = 1; i < points.length; i++) lengthM += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)

  // time estimate: integrate with the acceleration limit (simple forward pass)
  let t = 0
  let v = 0
  for (let i = 1; i < points.length; i++) {
    const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)
    const vmax = Math.min(points[i].vmax, Math.sqrt(Math.max(0.02, v * v + 2 * req.maxAccel * seg)))
    const vAvg = Math.max(0.08, (v + vmax) / 2)
    t += seg / vAvg
    v = vmax
  }

  return {
    id: req.id,
    points,
    lengthM,
    version: req.version,
    origin: req.origin,
    createdAt: req.now,
    costEstimateS: t,
    blockedAt: null,
  }
}

/** v = sqrt(a_lat * r) approximated from the discrete turn angle */
function curvatureSpeed(prev: Vec2, cur: Vec2, next: Vec2, maxV: number, maxAccel: number): number {
  const a1 = Math.atan2(cur.z - prev.z, cur.x - prev.x)
  const a2 = Math.atan2(next.z - cur.z, next.x - cur.x)
  let da = a2 - a1
  while (da > Math.PI) da -= 2 * Math.PI
  while (da < -Math.PI) da += 2 * Math.PI
  const seg = Math.hypot(next.x - cur.x, next.z - cur.z)
  if (seg < 1e-4) return maxV
  const curvature = Math.abs(da) / seg
  const aLat = maxAccel * 0.85
  if (curvature < 1e-3) return maxV
  return Math.min(maxV, Math.sqrt(aLat / curvature))
}

/**
 * Advance along a path from a pose: returns the projection, the look-ahead
 * target and the remaining arc length. Pure kinematics — the controller decides
 * the actual velocity.
 */
export function projectOnPath(path: Path, from: { x: number; z: number }, fromIndex: number) {
  let bestIdx = fromIndex
  let bestDist = Infinity
  // search a window around the last known index (cheap, avoids global re-projection)
  const lo = Math.max(0, fromIndex - 4)
  const hi = Math.min(path.points.length - 1, fromIndex + 26)
  for (let i = lo; i <= hi; i++) {
    const p = path.points[i]
    const d = (p.x - from.x) ** 2 + (p.z - from.z) ** 2
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  // remaining arc length
  let remaining = 0
  for (let i = bestIdx; i < path.points.length - 1; i++) {
    remaining += Math.hypot(path.points[i + 1].x - path.points[i].x, path.points[i + 1].z - path.points[i].z)
  }
  const distFromProj = Math.sqrt(bestDist)
  remaining = Math.max(0, remaining - distFromProj)
  return { index: bestIdx, distanceToPath: distFromProj, remaining }
}

/** look-ahead point used by the pure-pursuit controller */
export function lookAhead(path: Path, index: number, lookAheadM: number): { point: PathPoint; index: number } {
  let acc = 0
  let i = index
  while (i < path.points.length - 1) {
    acc += Math.hypot(path.points[i + 1].x - path.points[i].x, path.points[i + 1].z - path.points[i].z)
    i++
    if (acc >= lookAheadM) break
  }
  return { point: path.points[Math.min(i, path.points.length - 1)], index: Math.min(i, path.points.length - 1) }
}
