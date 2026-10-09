import * as THREE from 'three'

/* =========================================================================
 * Visual language — a restrained industrial palette.
 * Glow is rare and purposeful; colour carries meaning, not decoration.
 * ========================================================================= */

export const C = {
  floor: '#0b0f15',
  floorLine: '#1a2534',
  floorLineStrong: '#25344a',
  rack: '#634d36',
  rackTop: '#775e42',
  rackEdge: '#8a6b45',
  station: '#2a3a4a',
  conveyor: '#33414f',
  package: '#c9a468',
  obstacle: '#b8453f',
  sim: '#39c9e6',
  blue: '#4b8ef7',
  green: '#3fce8b',
  amber: '#e6b44a',
  red: '#e2585c',
  purple: '#9a7df0',
  orange: '#e08a4a',
  real: '#f0a04b',
  text: '#dbe3ee',
  dim: '#8b98ab',
}

export const statusColor = (status: string, fault?: string | null) => {
  if (fault) return C.red
  switch (status) {
    case 'FAILED':
      return C.red
    case 'BLOCKED':
    case 'WAITING':
      return C.amber
    case 'REPLANNING':
      return C.purple
    case 'CHARGING':
      return C.green
    case 'IDLE':
      return C.dim
    case 'E_STOP':
      return C.red
    default:
      return C.sim
  }
}

export const modeColor = (mode: string) => (mode === 'PHYSICAL' ? C.real : mode === 'MOCK' ? C.amber : C.sim)

/* -------------------------------------------------------------- label atlas */

const labelCache = new Map<string, THREE.CanvasTexture>()

export interface LabelOpts {
  color?: string
  bg?: string
  size?: number
  weight?: number
  border?: string
  mono?: boolean
}

/** canvas-rendered labels: no external font files, no DOM, properly occluded */
export function labelTexture(text: string, opts: LabelOpts = {}): THREE.CanvasTexture {
  const key = `${text}|${opts.color ?? ''}|${opts.bg ?? ''}|${opts.size ?? 40}|${opts.weight ?? 600}|${opts.border ?? ''}|${opts.mono ? 1 : 0}`
  const hit = labelCache.get(key)
  if (hit) return hit

  const size = opts.size ?? 40
  const weight = opts.weight ?? 600
  const font = `${weight} ${size}px ${opts.mono ? 'ui-monospace, "JetBrains Mono", SFMono-Regular, monospace' : 'Inter, "IBM Plex Sans", system-ui, sans-serif'}`
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const pad = Math.round(size * 0.42)
  const w = Math.ceil(measure.measureText(text).width) + pad * 2
  const h = Math.ceil(size * 1.55)

  const canvas = document.createElement('canvas')
  const dpr = 2
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, w, h)
  if (opts.bg) {
    ctx.fillStyle = opts.bg
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, Math.min(8, h / 3))
    ctx.fill()
    if (opts.border) {
      ctx.strokeStyle = opts.border
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
  ctx.font = font
  ctx.fillStyle = opts.color ?? '#dbe3ee'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + 1)

  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  tex.needsUpdate = true
  labelCache.set(key, tex)
  return tex
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/* ------------------------------------------------------------- line helpers */

export function makeLine(
  points: { x: number; z: number }[],
  color: string,
  opts: { width?: number; y?: number; opacity?: number; dashed?: boolean } = {},
): THREE.Line {
  const y = opts.y ?? 0.035
  const geom = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, y, p.z)))
  const mat = opts.dashed
    ? new THREE.LineDashedMaterial({ color, linewidth: opts.width ?? 1, dashSize: 0.35, gapSize: 0.28, transparent: true, opacity: opts.opacity ?? 1 })
    : new THREE.LineBasicMaterial({ color, linewidth: opts.width ?? 1, transparent: true, opacity: opts.opacity ?? 1 })
  const line = new THREE.Line(geom, mat)
  if (opts.dashed) line.computeLineDistances()
  return line
}

export function makeTrail(points: { x: number; z: number }[], color: string, y = 0.03) {
  const geom = new THREE.BufferGeometry()
  const verts: number[] = []
  const colors: number[] = []
  const base = new THREE.Color(color)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    verts.push(a.x, y, a.z, b.x, y, b.z)
    const t = i / points.length
    // alpha ramp is emulated by darkening the tail toward the floor colour
    const ca = base.clone().multiplyScalar(0.25 + 0.75 * (i / points.length))
    const cb = base.clone().multiplyScalar(0.25 + 0.75 * Math.min(1, (i + 1) / points.length))
    colors.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b)
    void t
  }
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 })
  return new THREE.LineSegments(geom, mat)
}

/* ------------------------------------------------------------ floor markings */

/** dashed floor outline for a rectangular footprint */
export function rectOutlinePoints(x: number, z: number, w: number, d: number) {
  const hw = w / 2
  const hd = d / 2
  return [
    { x: x - hw, z: z - hd },
    { x: x + hw, z: z - hd },
    { x: x + hw, z: z + hd },
    { x: x - hw, z: z + hd },
    { x: x - hw, z: z - hd },
  ]
}
