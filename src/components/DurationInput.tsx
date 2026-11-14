import { useMemo, type ReactNode } from 'react'
import { makeRng, sample } from '../sim/random'
import { formatDuration, fromUnit, toUnit } from '../sim/time'
import type { Distribution, DistType, TimeUnit } from '../sim/types'

const MODES: { type: DistType; label: string }[] = [
  { type: 'exponential', label: 'Exponential distribution' },
  { type: 'normal', label: 'Normal distribution' },
  { type: 'fixed', label: 'Fixed' },
  { type: 'uniform', label: 'Uniform distribution' },
  { type: 'triangular', label: 'Triangular distribution' },
  { type: 'lognormal', label: 'Log-normal distribution' },
  { type: 'gamma', label: 'Gamma distribution' },
]

const UNITS: TimeUnit[] = ['seconds', 'minutes', 'hours', 'days']

function Num({ value, onChange, unit }: { value: number; onChange: (seconds: number) => void; unit: TimeUnit }) {
  const shown = Math.round(toUnit(value, unit) * 1000) / 1000
  return (
    <input
      className="num"
      type="number"
      min={0}
      step="any"
      value={isFinite(shown) ? shown : 0}
      onChange={(e) => onChange(fromUnit(Math.max(0, parseFloat(e.target.value) || 0), unit))}
    />
  )
}

function convert(d: Distribution, type: DistType): Distribution {
  const mean = d.type === 'uniform' ? ((d.min ?? 0) + (d.max ?? 0)) / 2 : d.type === 'triangular' ? (d.mode ?? d.mean) : d.mean
  switch (type) {
    case 'normal':
    case 'lognormal':
    case 'gamma':
      return { type, unit: d.unit, mean, sd: d.sd ?? mean * 0.25 }
    case 'uniform':
      return { type, unit: d.unit, mean, min: d.min ?? mean * 0.5, max: d.max ?? mean * 1.5 }
    case 'triangular':
      return { type, unit: d.unit, mean, mode: mean, min: d.min ?? mean * 0.5, max: d.max ?? mean * 2 }
    default:
      return { type, unit: d.unit, mean }
  }
}

export default function DurationInput({ value, onChange }: { value: Distribution; onChange: (d: Distribution) => void }) {
  const d = value
  const u = d.unit
  const set = (patch: Partial<Distribution>) => {
    const next = { ...d, ...patch }
    if (next.type === 'uniform') next.mean = ((next.min ?? 0) + (next.max ?? 0)) / 2
    if (next.type === 'triangular') next.mean = ((next.min ?? 0) + (next.max ?? 0) + (next.mode ?? 0)) / 3
    onChange(next)
  }
  const range = useMemo(() => {
    const rng = makeRng(1)
    const xs = Array.from({ length: 2000 }, () => sample(d, rng)).sort((a, b) => a - b)
    return [xs[100], xs[1000], xs[1900]]
  }, [d])

  return (
    <div className="duration">
      <div className="row">
        <select value={d.type} onChange={(e) => onChange(convert(d, e.target.value as DistType))}>
          {MODES.map((m) => (
            <option key={m.type} value={m.type}>
              {m.label}
            </option>
          ))}
        </select>
        <select value={u} onChange={(e) => set({ unit: e.target.value as TimeUnit })}>
          {UNITS.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="row values">
        {d.type === 'fixed' && (
          <Field label="Duration">
            <Num unit={u} value={d.mean} onChange={(mean) => set({ mean })} />
          </Field>
        )}
        {d.type === 'exponential' && (
          <Field label="Mean">
            <Num unit={u} value={d.mean} onChange={(mean) => set({ mean })} />
          </Field>
        )}
        {(d.type === 'normal' || d.type === 'lognormal' || d.type === 'gamma') && (
          <>
            <Field label="Mean">
              <Num unit={u} value={d.mean} onChange={(mean) => set({ mean })} />
            </Field>
            <Field label="Standard deviation">
              <Num unit={u} value={d.sd ?? 0} onChange={(sd) => set({ sd })} />
            </Field>
          </>
        )}
        {d.type === 'uniform' && (
          <>
            <Field label="Minimum">
              <Num unit={u} value={d.min ?? 0} onChange={(min) => set({ min })} />
            </Field>
            <Field label="Maximum">
              <Num unit={u} value={d.max ?? 0} onChange={(max) => set({ max })} />
            </Field>
          </>
        )}
        {d.type === 'triangular' && (
          <>
            <Field label="Minimum">
              <Num unit={u} value={d.min ?? 0} onChange={(min) => set({ min })} />
            </Field>
            <Field label="Most likely">
              <Num unit={u} value={d.mode ?? d.mean} onChange={(mode) => set({ mode })} />
            </Field>
            <Field label="Maximum">
              <Num unit={u} value={d.max ?? 0} onChange={(max) => set({ max })} />
            </Field>
          </>
        )}
      </div>
      <p className="hint">
        {d.type === 'fixed'
          ? `Always ${formatDuration(d.mean)}.`
          : `Typically ${formatDuration(range[1])}; 9 in 10 runs between ${formatDuration(range[0])} and ${formatDuration(range[2])}.`}
      </p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="dist-field">
      <span>{label}</span>
      {children}
    </label>
  )
}
