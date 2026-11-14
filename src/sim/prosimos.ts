import { branchProbabilities } from './engine'
import { isWeightedSplit } from './graph'
import { defaultScenario } from './params'
import type { Distribution, ProcessGraph, Scenario, Timetable, TimetableRule } from './types'

/** Parameters for the Prosimos simulator (https://github.com/AutomatedProcessImprovement/Prosimos). */
export interface ProsimosExport {
  params: Record<string, unknown>
  /** model features Prosimos would simulate differently or not at all */
  unsupported: string[]
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const BIG = 1e9
const v = (...xs: number[]) => xs.map((value) => ({ value }))

export function prosimosDistribution(d: Distribution): { distribution_name: string; distribution_params: { value: number }[] } | string {
  const mean = Math.max(0, d.mean)
  const sd = Math.max(0, d.sd ?? 0)
  switch (d.type) {
    case 'fixed':
      return { distribution_name: 'fix', distribution_params: v(mean) }
    case 'exponential':
      return { distribution_name: 'expon', distribution_params: v(mean, 0, BIG) }
    case 'uniform':
      return { distribution_name: 'uniform', distribution_params: v(Math.max(0, d.min ?? 0), Math.max(0, d.max ?? 0)) }
    case 'normal':
      return { distribution_name: 'norm', distribution_params: v(mean, sd, 0, BIG) }
    case 'lognormal':
      return { distribution_name: 'lognorm', distribution_params: v(mean, sd * sd, 0, BIG) }
    case 'gamma':
      return { distribution_name: 'gamma', distribution_params: v(mean, (d.sd ?? mean) ** 2, 0, BIG) }
    default:
      return `${d.type} distribution`
  }
}

function periods(t: Timetable) {
  return t.rules.map((r) => ({
    from: DAYS[r.fromDay],
    to: DAYS[r.toDay],
    beginTime: `${r.from}:00.000`,
    endTime: r.to === '24:00' ? '23:59:59.999' : `${r.to}:00.000`,
  }))
}

/**
 * Translates a scenario into Prosimos's JSON parameters. Tasks without a role get an
 * unlimited, always available resource, because Prosimos needs a resource for every task.
 */
export function toProsimos(graph: ProcessGraph, s: Scenario): ProsimosExport {
  const unsupported = new Set<string>()
  const dist = (d: Distribution | undefined, where: string) => {
    const x = prosimosDistribution(d ?? { type: 'fixed', mean: 0, unit: 'seconds' })
    if (typeof x === 'string') {
      unsupported.add(`${x} (${where})`)
      return { distribution_name: 'fix', distribution_params: v(d?.mean ?? 0) }
    }
    return x
  }
  const calendars = s.timetables.map((t) => ({ id: t.id, name: t.name, time_periods: periods(t) }))
  const always = { id: 'psim_always', name: '24/7', time_periods: [{ from: 'MONDAY', to: 'SUNDAY', beginTime: '00:00:00.000', endTime: '23:59:59.999' }] }
  calendars.push(always)
  const profiles = s.resources.map((r) => ({
    id: r.id,
    name: r.name,
    resource_list: [{ id: r.id + '_pool', name: r.name, cost_per_hour: r.costPerHour, amount: String(r.count), calendar: r.timetableId, assignedTasks: [] as string[] }],
  }))
  const auto = { id: 'psim_auto', name: 'No role', resource_list: [{ id: 'psim_auto_pool', name: 'No role', cost_per_hour: 0, amount: '100000', calendar: always.id, assignedTasks: [] as string[] }] }
  const tasks = []
  for (const n of Object.values(graph.nodes)) {
    const p = s.elements[n.id] ?? {}
    if (n.kind === 'task') {
      const profile = profiles.find((x) => x.id === p.resourceId) ?? auto
      profile.resource_list[0].assignedTasks.push(n.id)
      tasks.push({ task_id: n.id, resources: [{ resource_id: profile.resource_list[0].id, ...dist(p.duration, n.name || n.id) }] })
      if (p.repeatProbability) unsupported.add(`loop marker on ${n.name || n.id}`)
      if (p.instances && p.instances > 1) unsupported.add(`multi-instance on ${n.name || n.id}`)
      if (p.maxQueue !== undefined) unsupported.add(`queue limit on ${n.name || n.id}`)
      if (p.revenue || p.fixedCost) unsupported.add(`revenue or fixed cost on ${n.name || n.id}`)
    } else if (n.kind === 'subprocess' || n.kind === 'boundary' || (n.kind === 'catch' && n.eventDef !== 'link')) {
      unsupported.add(`${n.kind} ${n.name || n.id}`)
    }
  }
  if (auto.resource_list[0].assignedTasks.length) profiles.push(auto)
  const gateways = Object.values(graph.nodes)
    .filter((n) => isWeightedSplit(graph, n.id))
    .map((n) => ({
      gateway_id: n.id,
      probabilities: Object.entries(branchProbabilities(graph, s, n.id)).map(([path_id, value]) => ({ path_id, value })),
    }))
  if (s.horizon) unsupported.add('time horizon (export uses a number of cases)')
  if (s.warmup || s.trim) unsupported.add('warm-up (apply it when analysing the Prosimos log)')
  return {
    params: {
      resource_profiles: profiles,
      arrival_time_distribution: dist(s.arrival, 'arrivals'),
      arrival_time_calendar: calendars.find((c) => c.id === s.arrivalTimetableId)?.time_periods ?? always.time_periods,
      gateway_branching_probabilities: gateways,
      task_resource_distribution: tasks,
      resource_calendars: calendars,
      event_distribution: [],
      batch_processing: [],
      case_attributes: [],
      prioritisation_rules: [],
    },
    unsupported: [...unsupported],
  }
}

// ---------------------------------------------------------------------------
// Import

interface PDist {
  distribution_name: string
  distribution_params: { value: number }[]
}
interface PPeriod {
  from: string
  to: string
  beginTime: string
  endTime: string
}

export function fromProsimosDistribution(d: PDist): Distribution {
  const p = d.distribution_params.map((x) => Number(x.value))
  switch (d.distribution_name) {
    case 'fix':
      return { type: 'fixed', mean: p[0], unit: 'seconds' }
    case 'expon':
      return p[1] ? { type: 'exponential', mean: p[0], unit: 'seconds', min: p[1] } : { type: 'exponential', mean: p[0], unit: 'seconds' }
    case 'uniform':
      return { type: 'uniform', mean: (p[0] + p[1]) / 2, min: p[0], max: p[1], unit: 'seconds' }
    case 'norm':
      return { type: 'normal', mean: p[0], sd: p[1], unit: 'seconds' }
    case 'lognorm':
      return { type: 'lognormal', mean: p[0], sd: Math.sqrt(p[1]), unit: 'seconds' }
    case 'gamma':
      return { type: 'gamma', mean: p[0], sd: Math.sqrt(p[1]), unit: 'seconds' }
    default:
      throw new Error(`Unsupported Prosimos distribution ${d.distribution_name}`)
  }
}

const hhmm = (t: string) => {
  const [h, m, sec] = t.split(':').map(parseFloat)
  return h === 23 && m === 59 && sec >= 59 ? '24:00' : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const rules = (ps: PPeriod[]): TimetableRule[] =>
  ps.map((x) => ({ fromDay: DAYS.indexOf(x.from), toDay: DAYS.indexOf(x.to), from: hhmm(x.beginTime), to: hhmm(x.endTime) }))

const meanOf = (d: Distribution) => (d.type === 'uniform' ? ((d.min ?? 0) + (d.max ?? 0)) / 2 : d.mean)
const varOf = (d: Distribution) =>
  d.type === 'fixed' ? 0 : d.type === 'exponential' ? (d.mean - (d.min ?? 0)) ** 2 : d.type === 'uniform' ? ((d.max ?? 0) - (d.min ?? 0)) ** 2 / 12 : (d.sd ?? 0) ** 2

/**
 * Builds a scenario from Prosimos parameters (for example a model discovered by Simod).
 * This tool has one duration per activity and one role per activity, so resource-specific
 * durations are merged into one distribution with the same mean and variance, and roles that
 * share an activity are pooled. Each role uses the calendar most of its resources have; truncation
 * bounds of distributions are ignored. Everything approximated is listed in `notes`.
 */
export function fromProsimos(
  graph: ProcessGraph,
  json: Record<string, unknown>,
  cases: number,
  startDate?: string,
): { scenario: Scenario; notes: string[] } {
  const notes: string[] = []
  const base = defaultScenario(graph)
  const cals = (json.resource_calendars as { id: string; name?: string; time_periods: PPeriod[] }[]) ?? []
  const timetables: Timetable[] = cals.map((c) => ({ id: c.id, name: c.name ?? c.id, rules: rules(c.time_periods) }))
  const arrivalPeriods = json.arrival_time_calendar as PPeriod[] | undefined
  if (arrivalPeriods?.length) timetables.push({ id: 'psim_arrivals', name: 'Arrival hours', rules: rules(arrivalPeriods) })
  type PRes = { id: string; name?: string; cost_per_hour?: number; amount?: string | number; calendar: string; assignedTasks?: string[] }
  type PTask = { task_id: string; resources: ({ resource_id: string } & PDist)[] }
  const profiles = (json.resource_profiles as { id: string; name?: string; resource_list: PRes[] }[]) ?? []
  const tasks = (json.task_resource_distribution as PTask[]) ?? []
  // One role per activity here: roles that share an activity are pooled, so no capacity is lost.
  const parent = new Map(profiles.map((p) => [p.id, p.id]))
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!))
  const profileOf = new Map<string, string>()
  for (const p of profiles) for (const r of p.resource_list) profileOf.set(r.id, p.id)
  for (const t of tasks) {
    const ps = [...new Set(t.resources.map((r) => profileOf.get(r.resource_id)).filter((x): x is string => !!x))]
    for (const q of ps.slice(1)) parent.set(find(q), find(ps[0]))
  }
  const owner = new Map<string, string>()
  const pools = new Map<string, { names: string[]; count: number; cost: number; cal: Map<string, number> }>()
  for (const p of profiles) {
    const root = find(p.id)
    const pool = pools.get(root) ?? { names: [], count: 0, cost: 0, cal: new Map<string, number>() }
    pool.names.push(p.name ?? p.id)
    for (const r of p.resource_list) {
      owner.set(r.id, root)
      const n = Number(r.amount ?? 1)
      pool.count += n
      pool.cost += (r.cost_per_hour ?? 0) * n
      pool.cal.set(r.calendar, (pool.cal.get(r.calendar) ?? 0) + n)
    }
    pools.set(root, pool)
  }
  const resources = [...pools.entries()].map(([id, p]) => {
    if (p.names.length > 1) notes.push(`roles ${p.names.join(', ')} share activities and are pooled into one role`)
    if (p.cal.size > 1) notes.push(`role ${p.names[0]}: ${p.cal.size} different calendars, using the most common`)
    const timetableId = [...p.cal.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'always'
    return { id, name: p.names.length > 1 ? 'Pooled roles' : p.names[0], count: p.count, costPerHour: p.count ? p.cost / p.count : 0, timetableId }
  })
  const elements: Scenario['elements'] = {}
  for (const t of tasks) {
    if (!graph.nodes[t.task_id]) continue
    const ds = t.resources.map((r) => fromProsimosDistribution(r))
    const votes = new Map<string, number>()
    for (const r of t.resources) {
      const o = owner.get(r.resource_id)
      if (o) votes.set(o, (votes.get(o) ?? 0) + 1)
    }
    const resourceId = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    let duration = ds[0]
    const same = ds.every((d) => JSON.stringify(d) === JSON.stringify(ds[0]))
    if (!same) {
      const m = ds.reduce((a, d) => a + meanOf(d), 0) / ds.length
      const v = ds.reduce((a, d) => a + varOf(d) + meanOf(d) ** 2, 0) / ds.length - m * m
      duration = { type: 'gamma', mean: m, sd: Math.sqrt(Math.max(v, 1e-9)), unit: 'seconds' }
      notes.push(`${graph.nodes[t.task_id].name || t.task_id}: ${ds.length} resource-specific durations merged into one gamma with the same mean and variance`)
    }
    elements[t.task_id] = { ...base.elements[t.task_id], duration, resourceId }
  }
  const flows: Record<string, number> = {}
  type PGw = { gateway_id: string; probabilities: { path_id: string; value: number }[] }
  for (const g of (json.gateway_branching_probabilities as PGw[]) ?? []) for (const p of g.probabilities) flows[p.path_id] = Number(p.value)
  for (const key of ['event_distribution', 'batch_processing', 'case_attributes', 'prioritisation_rules', 'branch_rules']) {
    const x = json[key]
    if (Array.isArray(x) && x.length) notes.push(`${key} not imported`)
  }
  const scenario: Scenario = {
    ...base,
    cases,
    startDate: startDate ?? base.startDate,
    arrival: fromProsimosDistribution(json.arrival_time_distribution as PDist),
    arrivalTimetableId: arrivalPeriods?.length ? 'psim_arrivals' : undefined,
    resources,
    timetables: timetables.length ? timetables : base.timetables,
    elements: { ...base.elements, ...elements },
    flows,
  }
  return { scenario, notes }
}
