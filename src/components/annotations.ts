import { branchFlows } from '../sim/graph'
import { branchProbabilities } from '../sim/engine'
import { formatDuration } from '../sim/time'
import type { ProcessGraph, Scenario, SimResult } from '../sim/types'
import type { Annotation } from './overlays'

type QueueStat = { peak: number; avg: number }

export function queueStats(r: SimResult): Record<string, QueueStat> {
  const byNode: Record<string, { t: number; d: number }[]> = {}
  for (const iv of r.intervals) {
    if (iv.start <= iv.arrive) continue
    ;(byNode[iv.node] ??= []).push({ t: iv.arrive, d: 1 }, { t: iv.start, d: -1 })
  }
  const end = r.intervals.reduce((m, i) => Math.max(m, i.end), 1)
  const out: Record<string, QueueStat> = {}
  for (const [id, evs] of Object.entries(byNode)) {
    evs.sort((a, b) => a.t - b.t || a.d - b.d)
    let q = 0
    let peak = 0
    let area = 0
    let last = 0
    for (const e of evs) {
      area += q * (e.t - last)
      last = e.t
      q += e.d
      peak = Math.max(peak, q)
    }
    out[id] = { peak, avg: area / end }
  }
  return out
}

/** Chips and heat per element: the settings before a run, waiting times and queues after it. */
export function annotate(graph: ProcessGraph, scenario: Scenario, result: SimResult | undefined, stale: boolean): Record<string, Annotation> {
  const out: Record<string, Annotation> = {}
  const queues = result ? queueStats(result) : {}
  const acts = result ? Object.fromEntries(result.activities.map((a) => [a.id, a])) : {}
  const maxWait = result ? Math.max(1, ...result.activities.map((a) => a.waiting.mean)) : 1
  for (const n of Object.values(graph.nodes)) {
    const p = scenario.elements[n.id]
    if (n.kind === 'task' || (n.kind === 'subprocess' && !n.starts.length)) {
      const a = acts[n.id]
      if (a && !stale) {
        const q = queues[n.id]
        const share = a.waiting.mean / maxWait
        out[n.id] = {
          heat: share > 0.66 ? 4 : share > 0.4 ? 3 : share > 0.2 ? 2 : share > 0.05 ? 1 : 0,
          chip: `waits ${formatDuration(a.waiting.mean)}${q && q.peak > 1 ? ` · queue up to ${q.peak}` : ''}`,
        }
      } else {
        const res = scenario.resources.find((r) => r.id === p?.resourceId)
        out[n.id] = { chip: `${p?.duration ? formatDuration(p.duration.mean) : 'no time'} · ${res ? res.name : 'auto'}`, muted: !p?.duration }
      }
    } else if (n.kind === 'catch' && p?.duration) {
      out[n.id] = { chip: `waits ${formatDuration(p.duration.mean)}` }
    } else if (n.kind === 'boundary') {
      out[n.id] = { chip: n.eventDef === 'timer' && p?.duration ? `after ${formatDuration(p.duration.mean)}` : `${Math.round((p?.probability ?? 0) * 100)} %` }
    }
  }
  return out
}

export function branchLabels(graph: ProcessGraph, scenario: Scenario): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of Object.values(graph.nodes)) {
    if (!branchFlows(graph, n.id).length) continue
    for (const [fid, p] of Object.entries(branchProbabilities(graph, scenario, n.id))) out[fid] = `${Math.round(p * 100)} %`
  }
  return out
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

/** Identifies a run: results are out of date as soon as the scenario or the model changes. */
export function runSignature(scenario: Scenario, xml: string): string {
  return JSON.stringify(scenario) + xml.length + ':' + hash(xml)
}
