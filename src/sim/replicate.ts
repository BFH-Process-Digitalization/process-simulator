import { simulate, type SimOptions } from './engine'
import type { ProcessGraph, Replications, Scenario, SimResult, Stats } from './types'

/** Two-sided 95 % quantiles of Student's t for 1..30 degrees of freedom. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
  2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
]

export function t95(df: number): number {
  if (df < 1) return Infinity
  if (df <= 30) return T95[Math.floor(df) - 1]
  const z = 1.959964
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df)
}

export interface Interval {
  n: number
  mean: number
  sd: number
  /** half-width of the 95 % confidence interval (Infinity for one run) */
  half: number
  lo: number
  hi: number
}

export function confidence(values: number[]): Interval {
  const xs = values.filter((v) => Number.isFinite(v))
  const n = xs.length
  const mean = n ? xs.reduce((a, b) => a + b, 0) / n : NaN
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0
  const half = n > 1 ? (t95(n - 1) * sd) / Math.sqrt(n) : Infinity
  return { n, mean, sd, half, lo: mean - half, hi: mean + half }
}

/** Paired difference b - a over runs with the same index (common random numbers). */
export function pairedDifference(a: number[], b: number[]): Interval & { significant: boolean } {
  const n = Math.min(a.length, b.length)
  const d: number[] = []
  for (let i = 0; i < n; i++) d.push(b[i] - a[i])
  const ci = confidence(d)
  return { ...ci, significant: n > 1 && (ci.lo > 0 || ci.hi < 0) }
}

/** The per-run numbers kept for every replication. */
export function summarize(r: SimResult): Record<string, number> {
  const out: Record<string, number> = {
    cycle: r.cycle.mean,
    waiting: r.waiting.mean,
    processing: r.processing.mean,
    cost: r.cost.mean,
    revenue: r.revenue.mean,
    throughputPerDay: r.throughputPerDay,
    throughputPerHour: r.throughputPerHour,
    casesCompleted: r.casesCompleted,
    casesBalked: r.casesBalked,
    wip: r.wip,
    pce: r.cycle.mean > 0 ? r.flow.va / r.cycle.mean : 0,
  }
  for (const [k, v] of Object.entries(r.flow)) out['flow.' + k] = v
  for (const res of r.resources) out['util.' + res.id] = res.utilisation
  for (const a of r.activities) {
    out['wait.' + a.id] = a.waiting.mean
    out['work.' + a.id] = a.processing.mean
  }
  return out
}

/** Seed of replication i: the same for every scenario, so runs are paired. */
export function replicationSeed(seed: number, i: number): number {
  return ((seed || 1) + i * 0x9e3779b1) >>> 0 || 1
}

/**
 * Simulates the scenario `scenario.replications` times (at least once). The first run is
 * returned in full (animation, log, charts); every run contributes its summary numbers.
 */
export function replicate(graph: ProcessGraph, scenario: Scenario, opts: SimOptions = {}, n = scenario.replications ?? 1): SimResult {
  const runs = Math.max(1, Math.floor(n))
  const seeds: number[] = []
  const values: Record<string, number[]> = {}
  const all: SimResult[] = []
  for (let i = 0; i < runs; i++) {
    const seed = replicationSeed(scenario.seed, i)
    seeds.push(seed)
    const r = simulate(graph, { ...scenario, seed }, i === 0 ? opts : { ...opts, traceCases: 0, logCases: 0 })
    all.push(r)
    for (const [k, v] of Object.entries(summarize(r))) (values[k] ??= []).push(v)
  }
  const reps: Replications = { n: runs, seeds, values }
  return { ...averageRuns(all), reps }
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function avgStats(xs: Stats[]): Stats {
  const out = { ...xs[0] }
  for (const k of Object.keys(out) as (keyof Stats)[]) out[k] = avg(xs.map((x) => x[k]))
  return out
}

function avgNumeric<T extends object>(xs: T[]): T {
  const out = { ...xs[0] } as Record<string, unknown>
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'number') out[k] = avg(xs.map((x) => (x as Record<string, number>)[k] ?? 0))
    else if (v && typeof v === 'object' && 'mean' in v && 'p90' in v) out[k] = avgStats(xs.map((x) => (x as Record<string, Stats>)[k]))
  }
  return out as T
}

/**
 * Averages the numbers of several runs (means, quantiles, counts, utilisation, value stream).
 * Histogram, paths, animation and event log stay those of the first run.
 */
export function averageRuns(rs: SimResult[]): SimResult {
  if (rs.length === 1) return rs[0]
  const base = avgNumeric(rs)
  const byId = <T extends { id: string }>(list: (r: SimResult) => T[]) =>
    list(rs[0]).map((x) => avgNumeric(rs.map((r) => list(r).find((y) => y.id === x.id) ?? x)))
  return {
    ...base,
    activities: byId((r) => r.activities),
    resources: byId((r) => r.resources),
    flow: avgNumeric(rs.map((r) => r.flow)),
  }
}

/** Mean over runs and its 95 % interval, or the single-run value. */
export function metricInterval(r: SimResult, key: string): Interval | undefined {
  const v = r.reps?.values[key]
  return v && v.length ? confidence(v) : undefined
}
