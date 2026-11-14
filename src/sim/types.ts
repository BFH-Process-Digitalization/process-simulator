export type TimeUnit = 'seconds' | 'minutes' | 'hours' | 'days'

export type DistType = 'fixed' | 'exponential' | 'normal' | 'uniform' | 'triangular' | 'lognormal' | 'gamma'

/** All values in seconds; `unit` is only the unit shown to the user. */
export interface Distribution {
  type: DistType
  mean: number
  sd?: number
  min?: number
  max?: number
  mode?: number
  unit: TimeUnit
}

export interface TimetableRule {
  /** 0 = Monday ... 6 = Sunday */
  fromDay: number
  toDay: number
  /** "HH:MM" */
  from: string
  to: string
}

export interface Timetable {
  id: string
  name: string
  rules: TimetableRule[]
}

export interface Resource {
  id: string
  name: string
  count: number
  costPerHour: number
  timetableId: string
}

/** Lean classification: value-adding, business value-adding (necessary), or waste. */
export type ValueClass = 'va' | 'bva' | 'nva'

export interface ElementParams {
  duration?: Distribution
  resourceId?: string
  fixedCost?: number
  /** Standard loop: probability that the activity is repeated after completion. */
  repeatProbability?: number
  /** Multi-instance: number of instances. */
  instances?: number
  /** Boundary events (non-timer): probability that the event occurs during the activity. */
  probability?: number
  /** Revenue earned each time the activity completes. */
  revenue?: number
  /** Cases leave without service when more than this many are already waiting for the resource. */
  maxQueue?: number
  value?: ValueClass
}

export interface Scenario {
  id: string
  name: string
  description?: string
  cases: number
  arrival: Distribution
  /** Arrivals only happen while this timetable is open (an arrival falling outside waits for the next opening). */
  arrivalTimetableId?: string
  /** ISO date-time of the first arrival (wall clock, treated as UTC). */
  startDate: string
  currency: string
  resources: Resource[]
  timetables: Timetable[]
  elements: Record<string, ElementParams>
  /** Sequence flow id -> probability 0..1 (gateway branches). */
  flows: Record<string, number>
  /** Share of cases (0..0.4) at the start and end that are left out of the statistics. */
  trim: number
  seed: number
  /** When set (seconds), new cases arrive only during this period instead of a fixed number of cases. */
  horizon?: number
  /** Simulated seconds at the start whose cases are left out of the statistics. */
  warmup?: number
  /** Independent runs per scenario; run i of every scenario uses the same random numbers. */
  replications?: number
}

export type NodeKind =
  | 'start'
  | 'end'
  | 'task'
  | 'subprocess'
  | 'xor'
  | 'and'
  | 'or'
  | 'eventGateway'
  | 'complex'
  | 'catch'
  | 'throw'
  | 'boundary'

export type EventDef =
  | 'none'
  | 'timer'
  | 'message'
  | 'error'
  | 'escalation'
  | 'signal'
  | 'conditional'
  | 'compensate'
  | 'link'
  | 'terminate'
  | 'cancel'

export interface GNode {
  id: string
  name: string
  type: string
  kind: NodeKind
  /** id of the enclosing process or subprocess */
  parent: string
  incoming: string[]
  outgoing: string[]
  eventDef: EventDef
  /** seconds, parsed from an ISO 8601 timeDuration */
  timerDuration?: number
  attachedTo?: string
  cancelActivity?: boolean
  boundaries: string[]
  defaultFlow?: string
  lane?: string
  multiInstance?: { sequential: boolean; cardinality?: number }
  loop?: boolean
  linkName?: string
  /** start nodes inside a subprocess */
  starts: string[]
}

export interface GFlow {
  id: string
  name: string
  source: string
  target: string
  conditional: boolean
}

export interface ProcessGraph {
  processId: string
  name: string
  nodes: Record<string, GNode>
  flows: Record<string, GFlow>
  starts: string[]
  lanes: string[]
  warnings: string[]
}

export interface Stats {
  mean: number
  median: number
  p90: number
  min: number
  max: number
  sum: number
  count: number
}

export interface ActivityStat {
  id: string
  name: string
  count: number
  waiting: Stats
  processing: Stats
  cost: number
  revenue: number
  /** cases that left instead of queueing here */
  balked: number
  resourceId?: string
  value?: ValueClass
}

export interface ResourceStat {
  id: string
  name: string
  count: number
  busySeconds: number
  availableSeconds: number
  utilisation: number
  /** cost of busy time */
  cost: number
  /** cost of all paid working time in the simulated period */
  paidCost: number
}

export interface PathStat {
  key: string
  label: string
  count: number
  share: number
  cycle: Stats
  waiting: Stats
  revenue: number
}

export interface ActivityInterval {
  node: string
  caseId: number
  arrive: number
  start: number
  end: number
}

export interface FlowPass {
  t: number
  flow: string
  caseId: number
}

export interface LogEvent {
  caseId: number
  activity: string
  activityId: string
  resource: string
  start: number
  end: number
}

export interface SimResult {
  scenarioId: string
  scenarioName: string
  startDate: string
  currency: string
  casesStarted: number
  casesCompleted: number
  /** cases that left because a queue was too long */
  casesBalked: number
  /** simulated seconds from the first arrival to the last completion */
  span: number
  cycle: Stats
  waiting: Stats
  processing: Stats
  cost: Stats
  /** completed cases per working day (24h) */
  throughputPerDay: number
  throughputPerHour: number
  revenue: Stats
  paths: PathStat[]
  activities: ActivityStat[]
  resources: ResourceStat[]
  histogram: { from: number; to: number; count: number }[]
  intervals: ActivityInterval[]
  passes: FlowPass[]
  log: LogEvent[]
  warnings: string[]
  /** time-average number of cases in the process */
  wip: number
  /** average lead time per case split by what happens (sums to the cycle time) */
  flow: FlowTime
  /** per-run values when the scenario was simulated more than once */
  reps?: Replications
}

export interface FlowTime {
  va: number
  bva: number
  nva: number
  rework: number
  none: number
  wait: number
}

export interface Replications {
  n: number
  seeds: number[]
  /** metric key -> one value per run */
  values: Record<string, number[]>
}
