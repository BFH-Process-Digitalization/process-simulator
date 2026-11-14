import { useEffect, useMemo, useRef, useState } from 'react'
import type { SimResult } from '../sim/types'
import type { Frame } from './overlays'

const SPEEDS = [
  { label: 'Real time', v: 1 },
  { label: '10 s / s', v: 10 },
  { label: '1 min / s', v: 60 },
  { label: '5 min / s', v: 300 },
  { label: '15 min / s', v: 900 },
  { label: '1 h / s', v: 3600 },
  { label: '8 h / s', v: 28800 },
  { label: '1 day / s', v: 86400 },
  { label: '1 week / s', v: 604800 },
]

/** Fastest speed that still takes about a minute to play the whole run. */
function defaultSpeed(span: number) {
  const fit = SPEEDS.filter((s) => s.v <= span / 60)
  return (fit[fit.length - 1] ?? SPEEDS[0]).v
}

function frameAt(r: SimResult, passes: SimResult['passes'], t: number, travel: number): Frame {
  const nodes: Frame['nodes'] = {}
  for (const iv of r.intervals) {
    if (iv.arrive > t || iv.end <= t) continue
    const n = (nodes[iv.node] ??= { queued: 0, working: 0 })
    if (t < iv.start) n.queued++
    else n.working++
  }
  const dots: Frame['dots'] = []
  let lo = 0
  let hi = passes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (passes[mid].t < t - travel) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < passes.length && passes[i].t <= t; i++) dots.push({ flow: passes[i].flow, frac: (t - passes[i].t) / travel })
  return { nodes, dots }
}

export default function Player({ result, onFrame }: { result: SimResult; onFrame: (f: Frame | null) => void }) {
  const end = useMemo(() => result.intervals.reduce((m, i) => Math.max(m, i.end), 0) || result.span, [result])
  const passes = useMemo(() => [...result.passes].sort((a, b) => a.t - b.t), [result])
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(() => defaultSpeed(end))
  const raf = useRef(0)
  const tRef = useRef(0)
  tRef.current = t

  useEffect(() => {
    setT(0)
    setPlaying(false)
  }, [result])

  useEffect(() => {
    onFrame(t > 0 || playing ? frameAt(result, passes, t, Math.min(speed * 0.4, Math.max(60, end / 300))) : null)
  }, [t, playing, result, passes, speed, end, onFrame])

  useEffect(() => () => onFrame(null), [onFrame])

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const next = tRef.current + dt * speed
      if (next >= end) {
        setT(end)
        setPlaying(false)
        return
      }
      setT(next)
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, speed, end])

  const clock = new Date(new Date(result.startDate).getTime() + t * 1000)
  const queued = useMemo(() => {
    let q = 0
    let w = 0
    for (const iv of result.intervals) {
      if (iv.arrive > t || iv.end <= t) continue
      if (t < iv.start) q++
      else w++
    }
    return { q, w }
  }, [result, t])

  return (
    <div className="player">
      <button
        className="play"
        title={playing ? 'Pause' : 'Play'}
        onClick={() => {
          if (!playing && t >= end) setT(0)
          setPlaying(!playing)
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <input className="scrub" type="range" min={0} max={end} step={end / 1000} value={t} onChange={(e) => setT(parseFloat(e.target.value))} />
      <div className="clock">
        <b>
          {clock.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' })}{' '}
          {clock.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
        </b>
        <span className="muted">
          {queued.w} working · {queued.q} waiting
        </span>
      </div>
      <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
        {SPEEDS.map((s) => (
          <option key={s.v} value={s.v}>
            {s.label}
          </option>
        ))}
      </select>
      <button className="link" onClick={() => { setPlaying(false); setT(0); onFrame(null) }}>
        Reset
      </button>
    </div>
  )
}
