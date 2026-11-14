import { branchFlows } from './graph'
import type { Distribution, ElementParams, GNode, ProcessGraph, Resource, Scenario, Timetable, TimeUnit } from './types'

export const OFFICE_HOURS: Timetable = {
  id: 'office',
  name: 'Office hours (Mon-Fri 9-17)',
  rules: [{ fromDay: 0, toDay: 4, from: '09:00', to: '17:00' }],
}
export const ALWAYS: Timetable = {
  id: 'always',
  name: 'Around the clock (24/7)',
  rules: [{ fromDay: 0, toDay: 6, from: '00:00', to: '24:00' }],
}

export function dist(type: Distribution['type'], mean: number, unit: TimeUnit, extra: Partial<Distribution> = {}): Distribution {
  return { type, mean, unit, ...extra }
}

const MIN = 60
const H = 3600

const RULES: [RegExp, number, TimeUnit][] = [
  [/(ship|deliver|transport|dispatch|versand|liefer)/i, 24 * H, 'hours'],
  [/(wait|await|warten)/i, 4 * H, 'hours'],
  [/(roast|produce|manufactur|build|repair|röst|produz)/i, 2 * H, 'hours'],
  [/(assess|evaluat|analy|investigat|audit|prüf|bewert|abklär)/i, 30 * MIN, 'minutes'],
  [/(review|check|verify|validat|inspect|kontroll)/i, 15 * MIN, 'minutes'],
  [/(approv|decide|sign|genehm|entscheid|freigab)/i, 10 * MIN, 'minutes'],
  [/(meet|interview|call|consult|gespräch|beratung)/i, 45 * MIN, 'minutes'],
  [/(prepare|create|write|draft|compose|erstell|vorbereit)/i, 20 * MIN, 'minutes'],
  [/(pack|pick|kommission|verpack)/i, 10 * MIN, 'minutes'],
  [/(notify|send|email|mail|inform|confirm|benachricht|senden|bestätig)/i, 3 * MIN, 'minutes'],
  [/(register|record|enter|log|file|erfass|registr)/i, 5 * MIN, 'minutes'],
  [/(pay|invoice|bill|zahl|rechnung)/i, 10 * MIN, 'minutes'],
  [/(receive|get|empfang|erhalt)/i, 5 * MIN, 'minutes'],
]

const AUTOMATED = new Set(['serviceTask', 'scriptTask', 'businessRuleTask'])

/** A rough first guess from the activity label. */
export function guessDuration(node: Pick<GNode, 'name' | 'type'>): Distribution {
  if (AUTOMATED.has(node.type)) return dist('fixed', 30, 'seconds')
  for (const [re, mean, unit] of RULES) {
    if (re.test(node.name)) return dist('normal', mean, unit, { sd: mean * 0.25 })
  }
  return dist('normal', 15 * MIN, 'minutes', { sd: 15 * MIN * 0.25 })
}

export function resourceIdFor(name: string): string {
  return 'res_' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'staff')
}

export function defaultScenario(graph: ProcessGraph): Scenario {
  const resources: Resource[] = (graph.lanes.length ? graph.lanes : ['Staff']).map((name) => ({
    id: resourceIdFor(name),
    name,
    count: 2,
    costPerHour: 50,
    timetableId: OFFICE_HOURS.id,
  }))
  const fallback = resources[0]?.id
  const elements: Record<string, ElementParams> = {}
  for (const n of Object.values(graph.nodes)) {
    if (n.kind === 'task' || (n.kind === 'subprocess' && !n.starts.length)) {
      elements[n.id] = {
        duration: guessDuration(n),
        resourceId: AUTOMATED.has(n.type) ? undefined : n.lane ? resourceIdFor(n.lane) : fallback,
      }
    } else if (n.kind === 'catch' && n.eventDef !== 'link') {
      const d = n.timerDuration
      elements[n.id] = {
        duration: d !== undefined ? dist('fixed', d, d >= 2 * H ? 'hours' : 'minutes') : dist('exponential', 4 * H, 'hours'),
      }
    } else if (n.kind === 'boundary') {
      elements[n.id] =
        n.eventDef === 'timer'
          ? { duration: dist('fixed', n.timerDuration ?? 24 * H, 'hours') }
          : { probability: 0.1 }
    }
  }
  return {
    id: 'baseline',
    name: 'Baseline',
    cases: 200,
    arrival: dist('exponential', 30 * MIN, 'minutes'),
    startDate: nextMonday(),
    currency: 'CHF',
    resources,
    timetables: [OFFICE_HOURS, ALWAYS],
    elements,
    flows: defaultFlows(graph),
    trim: 0,
    seed: 42,
    warmup: 0,
    replications: 10,
  }
}

const NEGATIVE = /\b(no|not|nein|reject|denied|declin|fail|invalid|incomplete|abgelehnt|unvollständig|fehl|error)/i
const POSITIVE = /\b(yes|ja|ok|approved|accept|granted|valid|complete|vollständig|in stock|available)/i

export function defaultFlows(graph: ProcessGraph): Record<string, number> {
  const flows: Record<string, number> = {}
  for (const n of Object.values(graph.nodes)) {
    const outs = branchFlows(graph, n.id)
    if (outs.length !== 2 || n.kind === 'or') continue
    const [a, b] = outs
    const neg = (f: typeof a) => NEGATIVE.test(f.name) && !POSITIVE.test(f.name)
    const pos = (f: typeof a) => POSITIVE.test(f.name)
    if ((pos(a) || neg(b)) && !(pos(b) || neg(a))) {
      flows[a.id] = 0.8
      flows[b.id] = 0.2
    } else if ((pos(b) || neg(a)) && !(pos(a) || neg(b))) {
      flows[a.id] = 0.2
      flows[b.id] = 0.8
    }
  }
  return flows
}

function nextMonday(): string {
  const d = new Date()
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() + ((7 - day) % 7 || 7))
  d.setUTCHours(9, 0, 0, 0)
  return d.toISOString()
}

/** Fills params for elements that were added to the model after the scenario was made. */
export function completeScenario(graph: ProcessGraph, s: Scenario): Scenario {
  const defaults = defaultScenario(graph)
  const elements = { ...s.elements }
  let changed = false
  for (const [id, p] of Object.entries(defaults.elements)) {
    if (!elements[id]) {
      const node = graph.nodes[id]
      const lane = node?.lane ? resourceIdFor(node.lane) : undefined
      elements[id] = { ...p, resourceId: p.resourceId && (s.resources.some((r) => r.id === lane) ? lane : s.resources[0]?.id) }
      changed = true
    }
  }
  return changed ? { ...s, elements } : s
}

// ---------------------------------------------------------------------------
// Scenarios: one baseline with full parameters, variants store only overrides.

export type OverrideKey = string
export type Overrides = Record<OverrideKey, unknown>

export interface Variant {
  id: string
  name: string
  description?: string
  overrides: Overrides
}

export interface Project {
  baseline: Scenario
  variants: Variant[]
}

const TOP = ['cases', 'arrival', 'arrivalTimetableId', 'startDate', 'currency', 'trim', 'seed', 'horizon', 'warmup', 'replications'] as const

export function readKey(s: Scenario, key: OverrideKey): unknown {
  const [kind, id] = splitKey(key)
  switch (kind) {
    case 'element':
      return s.elements[id]
    case 'flow':
      return s.flows[id]
    case 'resource':
      return s.resources.find((r) => r.id === id) ?? null
    case 'timetable':
      return s.timetables.find((t) => t.id === id) ?? null
    default:
      return (s as unknown as Record<string, unknown>)[kind]
  }
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf(':')
  return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i + 1)]
}

export function writeKey(s: Scenario, key: OverrideKey, value: unknown): Scenario {
  const [kind, id] = splitKey(key)
  switch (kind) {
    case 'element': {
      const elements = { ...s.elements }
      if (value === undefined || value === null) delete elements[id]
      else elements[id] = value as ElementParams
      return { ...s, elements }
    }
    case 'flow': {
      const flows = { ...s.flows }
      if (value === undefined || value === null) delete flows[id]
      else flows[id] = value as number
      return { ...s, flows }
    }
    case 'resource': {
      const rest = s.resources.filter((r) => r.id !== id)
      if (value === null || value === undefined) return { ...s, resources: rest }
      const i = s.resources.findIndex((r) => r.id === id)
      const resources = [...s.resources]
      if (i >= 0) resources[i] = value as Resource
      else resources.push(value as Resource)
      return { ...s, resources }
    }
    case 'timetable': {
      const rest = s.timetables.filter((t) => t.id !== id)
      if (value === null || value === undefined) return { ...s, timetables: rest }
      const i = s.timetables.findIndex((t) => t.id === id)
      const timetables = [...s.timetables]
      if (i >= 0) timetables[i] = value as Timetable
      else timetables.push(value as Timetable)
      return { ...s, timetables }
    }
    default:
      if ((TOP as readonly string[]).includes(kind)) return { ...s, [kind]: value }
      return s
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export function resolve(project: Project, scenarioId: string): Scenario {
  if (scenarioId === project.baseline.id) return project.baseline
  const v = project.variants.find((x) => x.id === scenarioId)
  if (!v) return project.baseline
  let s: Scenario = { ...project.baseline, id: v.id, name: v.name, description: v.description }
  for (const [k, val] of Object.entries(v.overrides)) s = writeKey(s, k, val)
  return s
}

/** Sets a value in a scenario. In a variant, values equal to the baseline drop out of the overrides. */
export function setValue(project: Project, scenarioId: string, key: OverrideKey, value: unknown): Project {
  if (scenarioId === project.baseline.id) return { ...project, baseline: writeKey(project.baseline, key, value) }
  return {
    ...project,
    variants: project.variants.map((v) => {
      if (v.id !== scenarioId) return v
      const overrides = { ...v.overrides }
      if (same(readKey(project.baseline, key), value)) delete overrides[key]
      else overrides[key] = value ?? null
      return { ...v, overrides }
    }),
  }
}

export function changeCount(v: Variant): number {
  return Object.keys(v.overrides).length
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

export function addVariant(project: Project, name: string, overrides: Overrides = {}, description?: string): [Project, string] {
  const id = newId('sc')
  return [{ ...project, variants: [...project.variants, { id, name, description, overrides }] }, id]
}
