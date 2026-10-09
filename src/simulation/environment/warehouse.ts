/**
 * Shared simulated warehouse.
 *
 * This is the ONE environment every agent lives in. It owns:
 *   - static geometry (racks, walls, pillars, conveyors, chargers)
 *   - semantic zones (inbound, outbound, packing, sorting, charging, aisles)
 *   - the occupancy + clearance grid used for planning
 *   - mutable world contents (packages, temporary obstacles, congestion)
 *
 * It is deliberately dumb: it holds state and answers geometric queries.
 * All intelligence lives in agents/.
 */

import { OccupancyGrid, CELL } from './grid';
import type {
  ChargingStation,
  Obstacle,
  Package,
  WarehouseObject,
  WarehouseZone,
  ZoneKind,
} from '../types';
import { mulberry32 } from '../core/rng';

/**
 * Layout geometry note.
 *
 * Every drivable corridor is 2.5 m wide. With a 0.5 m navigation cell and a
 * "stay at least one cell clear of structure" rule, each corridor yields a
 * 1.5 m drivable lane — enough for two 0.72 m AMRs to pass (they need ~0.94 m
 * of lateral separation) while still being tight enough to produce genuine
 * traffic conflicts. Narrower corridors caused deadlocks during validation.
 */
export const WORLD_W = 44;
export const WORLD_H = 33.5;

const RACK_W = 2.0;
const RACK_L = 5.0;
const AISLE = 2.5;
const CROSS_AISLE = 2.5;

const STORAGE_X0 = 9.0;
const ROW_Y = [3.0, 10.5, 18.0, 25.5];

const PACKAGES_PER_RACK = 4;

export interface WarehouseInit {
  seed: number;
  /** multiplier on rack density — lets scenarios create "task surge" layouts */
  rackDensity?: number;
}

export class Warehouse {
  readonly grid: OccupancyGrid;
  readonly zones: WarehouseZone[] = [];
  readonly objects: WarehouseObject[] = [];
  readonly racks: WarehouseObject[] = [];
  readonly chargers: ChargingStation[] = [];
  readonly packages: Package[] = [];
  obstacles: Obstacle[] = [];
  readonly seed: number;

  private zoneLookup = new Map<string, number>();

  constructor(init: WarehouseInit) {
    this.seed = init.seed;
    this.grid = new OccupancyGrid(WORLD_W, WORLD_H, CELL);
    const rnd = mulberry32(init.seed);
    this.buildZones();
    this.buildStaticGeometry(rnd);
    this.grid.computeClearance(6);
    this.buildChargers();
    this.buildPackages(rnd);
    this.rebuildDynamicGrid();
  }

  // ── construction ──────────────────────────────────────────────────────────

  private buildZones() {
    const defs: WarehouseZone[] = [
      { id: 'Z-INBOUND', name: 'INBOUND', kind: 'INBOUND', x0: 0.5, y0: 22.0, x1: 7.0, y1: 31.5, color: '#38BDF8' },
      { id: 'Z-SORTING', name: 'SORTING', kind: 'SORTING', x0: 0.5, y0: 1.5, x1: 7.0, y1: 12.5, color: '#A78BFA' },
      { id: 'Z-OUTBOUND', name: 'OUTBOUND', kind: 'OUTBOUND', x0: 37.0, y0: 22.0, x1: 43.5, y1: 31.5, color: '#34D399' },
      { id: 'Z-PACKING', name: 'PACKING', kind: 'PACKING', x0: 37.0, y0: 1.5, x1: 43.5, y1: 12.5, color: '#FB923C' },
      { id: 'Z-STORAGE', name: 'STORAGE', kind: 'STORAGE', x0: 8.5, y0: 2.5, x1: 34.0, y1: 31.0, color: '#FBBF24' },
      { id: 'Z-CHARGE-N', name: 'CHARGING NORTH', kind: 'CHARGING', x0: 13.0, y0: 30.6, x1: 27.0, y1: 32.4, color: '#34D399' },
      { id: 'Z-CHARGE-S', name: 'CHARGING SOUTH', kind: 'CHARGING', x0: 13.0, y0: 1.1, x1: 27.0, y1: 2.9, color: '#34D399' },
      { id: 'Z-DOCK-W', name: 'LOADING WEST', kind: 'LOADING', x0: 0.5, y0: 13.0, x1: 4.0, y1: 21.0, color: '#64748B' },
      { id: 'Z-DOCK-E', name: 'LOADING EAST', kind: 'LOADING', x0: 40.0, y0: 13.0, x1: 43.5, y1: 21.0, color: '#64748B' },
    ];
    defs.forEach((z, i) => {
      this.zones.push(z);
      this.zoneLookup.set(z.id, i);
      this.grid.tagZone(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0, i);
    });

    // Everything not explicitly zoned but walkable inside storage is an aisle.
    const aisle: WarehouseZone = {
      id: 'Z-AISLE',
      name: 'AISLE NETWORK',
      kind: 'AISLE',
      x0: 0.5,
      y0: 0.5,
      x1: 43.5,
      y1: 31.5,
      color: '#334155',
    };
    this.zones.push(aisle);
    this.zoneLookup.set(aisle.id, this.zones.length - 1);
  }

  private buildStaticGeometry(rnd: () => number) {
    // perimiter walls
    const wall = (id: string, x: number, y: number, w: number, h: number) => {
      this.objects.push({ id, kind: 'WALL', x, y, w, h, height: 1.2 });
      this.grid.blockRect(x, y, w, h);
    };
    wall('W-S', 0, 0, WORLD_W, 0.5);
    wall('W-N', 0, WORLD_H - 0.5, WORLD_W, 0.5);
    wall('W-W', 0, 0, 0.5, WORLD_H);
    wall('W-E', WORLD_W - 0.5, 0, 0.5, WORLD_H);

    // Structural columns. Deliberately placed in the wide north-south service
    // corridors — never in an aisle — so the layout always stays navigable
    // while still creating real pinch points for the traffic demos.
    const pillarSpots: [number, number][] = [
      [6.6, 14.0], [6.6, 20.0],
      [36.8, 14.0], [36.8, 20.0],
    ];
    pillarSpots.forEach(([px, py], i) => {
      this.objects.push({ id: `PIL-${i + 1}`, kind: 'PILLAR', x: px, y: py, w: 0.5, h: 0.5, height: 3.4 });
      this.grid.blockRect(px - 0.25, py - 0.25, 0.5, 0.5);
    });

    // storage rack columns
    let x = STORAGE_X0;
    let col = 0;
    const rackCols: { x: number; col: number }[] = [];
    while (x + RACK_W <= 34.0) {
      rackCols.push({ x, col });
      x += RACK_W + AISLE;
      col++;
    }

    for (const { x: rx, col: c } of rackCols) {
      // split the column into rack segments separated by cross aisles
      let y = ROW_Y[0];
      let row = 0;
      while (y + RACK_L <= 30.5) {
        const id = `RACK-${String.fromCharCode(65 + c)}${row + 1}`;
        const eastFace = c % 2 === 0;
        const pickX = eastFace ? rx + RACK_W + 0.75 : rx - 0.75;
        const obj: WarehouseObject = {
          id,
          kind: 'RACK',
          x: rx + RACK_W / 2,
          y: y + RACK_L / 2,
          w: RACK_W,
          h: RACK_L,
          height: 2.6 + (rnd() * 0.5 - 0.25),
          zoneId: 'Z-STORAGE',
          label: id,
          pickFace: { x: pickX, y: y + RACK_L / 2 },
        };
        this.objects.push(obj);
        this.racks.push(obj);
        this.grid.blockRect(rx, y, RACK_W, RACK_L);
        y += RACK_L + CROSS_AISLE;
        row++;
      }
    }

    // Conveyor spines feeding packing (east) and sorting (west). The west
    // spine is widened to 8.5→9.0 so it seals the dead-end sliver between the
    // conveyor and rack column A (agents would otherwise wedge into it).
    this.objects.push({ id: 'CONV-1', kind: 'CONVEYOR', x: 35.5, y: 17.0, w: 1.0, h: 9.0, height: 0.9, zoneId: 'Z-PACKING' });
    this.grid.blockRect(35.0, 12.5, 1.0, 9.0);
    this.objects.push({ id: 'CONV-2', kind: 'CONVEYOR', x: 8.3, y: 17.0, w: 1.4, h: 9.0, height: 0.9, zoneId: 'Z-SORTING' });
    this.grid.blockRect(7.6, 12.5, 1.4, 9.0);

    // pallet stacks (semi-static clutter) — these make narrow-aisle traffic real
    const palletSpots: [number, number][] = [
      [5.2, 14.5], [5.2, 19.5], [38.2, 14.5], [38.2, 19.5],
      [11.6, 9.2], [20.6, 9.2], [29.6, 9.2],
      [11.6, 24.2], [20.6, 24.2], [29.6, 24.2],
    ];
    palletSpots.forEach(([px, py], i) => {
      this.objects.push({ id: `PALLET-${i + 1}`, kind: 'PALLET', x: px, y: py, w: 1.0, h: 1.0, height: 0.7 });
      this.grid.blockRect(px - 0.5, py - 0.5, 1.0, 1.0);
    });
  }

  private buildChargers() {
    const spots: [number, number][] = [
      [15.0, 2.0], [19.0, 2.0], [23.0, 2.0],
      [15.0, 31.5], [19.0, 31.5], [23.0, 31.5],
    ];
    spots.forEach(([cx, cy], i) => {
      this.chargers.push({ id: `CHG-${String(i + 1).padStart(2, '0')}`, x: cx, y: cy, occupiedBy: null, power: 2.2 });
      this.objects.push({ id: `CHG-OBJ-${i + 1}`, kind: 'CHARGER', x: cx, y: cy, w: 0.9, h: 0.9, height: 1.1, label: `CHG-${i + 1}` });
    });
  }

  private buildPackages(rnd: () => number) {
    this.racks.forEach((rack) => {
      for (let s = 0; s < PACKAGES_PER_RACK; s++) {
        const t = (s + 0.5) / PACKAGES_PER_RACK;
        const py = rack.y - rack.h / 2 + t * rack.h;
        const side = rack.pickFace!.x > rack.x ? 1 : -1;
        this.packages.push({
          id: `PKG-${this.packages.length + 1}`,
          x: rack.x + side * (rack.w / 2 + 0.35),
          y: py,
          state: 'STORED',
          rackId: rack.id,
          weightKg: Math.round((0.6 + rnd() * 4.2) * 10) / 10,
        });
      }
    });
  }

  // ── dynamic world ─────────────────────────────────────────────────────────

  rebuildDynamicGrid() {
    this.grid.clearDynamic();
    for (const o of this.obstacles) this.grid.blockCircle(o.x, o.y, o.r);
  }

  addObstacle(o: Obstacle) {
    this.obstacles.push(o);
    this.grid.blockCircle(o.x, o.y, o.r);
  }

  removeObstacle(id: string) {
    this.obstacles = this.obstacles.filter((o) => o.id !== id);
    this.rebuildDynamicGrid();
  }

  clearTemporaryObstacles() {
    this.obstacles = this.obstacles.filter((o) => o.kind === 'STATIC');
    this.rebuildDynamicGrid();
  }

  /** Expire temporary obstacles. Returns the ones that expired. */
  expireObstacles(now: number): Obstacle[] {
    const expired: Obstacle[] = [];
    const kept: Obstacle[] = [];
    for (const o of this.obstacles) {
      if (o.ttl >= 0 && now - o.createdAt > o.ttl) expired.push(o);
      else kept.push(o);
    }
    if (expired.length) {
      this.obstacles = kept;
      this.rebuildDynamicGrid();
    }
    return expired;
  }

  // ── queries ───────────────────────────────────────────────────────────────

  zoneAt(x: number, y: number): WarehouseZone {
    const { ix, iy } = this.grid.worldToCell(x, y);
    if (!this.grid.inBounds(ix, iy)) return this.zones[this.zones.length - 1];
    const zi = this.grid.zoneIndex[this.grid.idx(ix, iy)];
    if (zi >= 0) return this.zones[zi];
    // fall back to the smallest containing zone
    let best: WarehouseZone | null = null;
    let bestArea = Infinity;
    for (const z of this.zones) {
      if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) {
        const a = (z.x1 - z.x0) * (z.y1 - z.y0);
        if (a < bestArea) {
          bestArea = a;
          best = z;
        }
      }
    }
    return best ?? this.zones[this.zones.length - 1];
  }

  zoneKindAt(x: number, y: number): ZoneKind {
    return this.zoneAt(x, y).kind;
  }

  /** Nearest walkable cell centre to a world point. */
  nearestFree(x: number, y: number, maxRing = 24): { x: number; y: number } {
    const c = this.grid.worldToCell(x, y);
    if (!this.grid.isBlocked(c.ix, c.iy)) return this.grid.cellToWorld(c.ix, c.iy);
    for (let r = 1; r <= maxRing; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const ix = c.ix + dx;
          const iy = c.iy + dy;
          if (!this.grid.isBlocked(ix, iy)) return this.grid.cellToWorld(ix, iy);
        }
      }
    }
    return { x, y };
  }

  isFree(x: number, y: number): boolean {
    const c = this.grid.worldToCell(x, y);
    return !this.grid.isBlocked(c.ix, c.iy);
  }

  nearestCharger(x: number, y: number): ChargingStation {
    let best = this.chargers[0];
    let bd = Infinity;
    for (const c of this.chargers) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  rackById(id: string) {
    return this.racks.find((r) => r.id === id);
  }

  packageById(id: string) {
    return this.packages.find((p) => p.id === id);
  }

  /** A stored package that nobody has reserved yet. */
  pickRandomAvailablePackage(rnd: () => number): Package | null {
    const avail = this.packages.filter((p) => p.state === 'STORED' && !p.taskId);
    if (!avail.length) return null;
    return avail[Math.floor(rnd() * avail.length)];
  }
}

export const ZONE_COLORS: Record<ZoneKind, string> = {
  INBOUND: '#38BDF8',
  OUTBOUND: '#34D399',
  STORAGE: '#FBBF24',
  PACKING: '#FB923C',
  SORTING: '#A78BFA',
  CHARGING: '#34D399',
  LOADING: '#64748B',
  AISLE: '#334155',
  RESTRICTED: '#F87171',
};
