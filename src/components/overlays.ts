export interface Annotation {
  chip?: string
  heat?: number
  muted?: boolean
}

export interface Frame {
  dots: { flow: string; frac: number }[]
  nodes: Record<string, { queued: number; working: number }>
}

/** Any bpmn-js viewer or modeler: services are looked up by name. */
export interface Diagram {
  get<T = unknown>(name: string): T
}

interface Shape {
  id: string
  x: number
  y: number
  width: number
  height: number
  waypoints?: { x: number; y: number }[]
  type: string
}

type Overlays = { remove(f: { type: string }): void; add(id: string, type: string, o: object): void }
type Registry = { get(id: string): Shape | undefined; getAll(): Shape[] }
type Canvas = { addMarker(id: string, c: string): void; removeMarker(id: string, c: string): void; getLayer(n: string, i: number): SVGGElement }

const SVG = 'http://www.w3.org/2000/svg'

function pointAt(points: { x: number; y: number }[], frac: number) {
  let total = 0
  const seg: number[] = []
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    seg.push(d)
    total += d
  }
  let left = total * Math.min(1, Math.max(0, frac))
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? left / seg[i] : 0
      return { x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f }
    }
    left -= seg[i]
  }
  return points[0]
}

function el(name: string, attrs: Record<string, string | number>) {
  const e = document.createElementNS(SVG, name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

export function clearOverlays(m: Diagram) {
  m.get<Overlays>('overlays').remove({ type: 'sim' })
  const canvas = m.get<Canvas>('canvas')
  for (const s of m.get<Registry>('elementRegistry').getAll()) {
    for (let h = 0; h <= 4; h++) canvas.removeMarker(s.id, `heat-${h}`)
  }
}

/** Draws the parameter or result chips, waiting-time heat and branch percentages onto the diagram. */
export function applyOverlays(m: Diagram, annotations: Record<string, Annotation>, branchLabels: Record<string, string>) {
  clearOverlays(m)
  const overlays = m.get<Overlays>('overlays')
  const registry = m.get<Registry>('elementRegistry')
  const canvas = m.get<Canvas>('canvas')
  for (const [id, a] of Object.entries(annotations)) {
    const shape = registry.get(id)
    if (!shape || shape.waypoints) continue
    if (a.heat !== undefined) canvas.addMarker(id, `heat-${a.heat}`)
    if (!a.chip) continue
    const div = document.createElement('div')
    div.className = 'sim-chip' + (a.muted ? ' muted' : '')
    div.textContent = a.chip
    overlays.add(id, 'sim', { position: { top: shape.height + 4, left: 0 }, html: div })
  }
  for (const [id, label] of Object.entries(branchLabels)) {
    const shape = registry.get(id)
    if (!shape?.waypoints || shape.waypoints.length < 2) continue
    const p = pointAt(shape.waypoints, 0.5)
    const div = document.createElement('div')
    div.className = 'sim-branch'
    div.textContent = label
    overlays.add(id, 'sim', { position: { top: p.y - shape.y - 9, left: p.x - shape.x + 6 }, html: div })
  }
}

/** Draws one playback frame: queued cases in front of each task, working cases inside, moving tokens on flows. */
export function drawFrame(m: Diagram, frame: Frame | null) {
  const canvas = m.get<Canvas>('canvas')
  const registry = m.get<Registry>('elementRegistry')
  const layer = canvas.getLayer('sim-tokens', 1000)
  while (layer.firstChild) layer.removeChild(layer.firstChild)
  if (!frame) return
  for (const [id, s] of Object.entries(frame.nodes)) {
    const shape = registry.get(id)
    if (!shape) continue
    const isTask = shape.width >= 80
    if (s.queued > 0) {
      const level = s.queued <= 2 ? 'low' : s.queued <= 5 ? 'mid' : 'high'
      const q = Math.min(s.queued, 5)
      for (let i = 0; i < q; i++) {
        const g = el('g', { transform: `translate(${shape.x + 2 + i * 10} ${shape.y - 17})`, class: 'tok-person ' + level })
        g.appendChild(el('circle', { cx: 4, cy: 3, r: 2.6 }))
        g.appendChild(el('path', { d: 'M0 12 Q0 6.5 4 6.5 Q8 6.5 8 12 Z' }))
        layer.appendChild(g)
      }
      const t = el('text', { x: shape.x + 4 + q * 10, y: shape.y - 6, class: 'tok-qlabel ' + level })
      t.textContent = `${s.queued} waiting`
      layer.appendChild(t)
    }
    const w = Math.min(s.working, isTask ? 6 : 1)
    for (let i = 0; i < w; i++) {
      const cx = isTask ? shape.x + 12 + i * 12 : shape.x + shape.width / 2
      const cy = isTask ? shape.y + shape.height - 11 : shape.y + shape.height / 2
      layer.appendChild(el('circle', { cx, cy, r: isTask ? 4.5 : 6, class: 'tok-work' }))
    }
    if (s.working > (isTask ? 6 : 1)) {
      const t = el('text', {
        x: isTask ? shape.x + 12 + 6 * 12 : shape.x + shape.width + 4,
        y: isTask ? shape.y + shape.height - 7 : shape.y - 2,
        class: 'tok-label',
      })
      t.textContent = String(s.working)
      layer.appendChild(t)
    }
  }
  for (const d of frame.dots) {
    const shape = registry.get(d.flow)
    if (!shape?.waypoints) continue
    const p = pointAt(shape.waypoints, d.frac)
    layer.appendChild(el('circle', { cx: p.x, cy: p.y, r: 5, class: 'tok-move' }))
  }
}
