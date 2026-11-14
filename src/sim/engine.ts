import { randomSource, sample, type RngMode } from './random'
import { Calendar, weekOffset } from './time'
import { branchFlows } from './graph'
import type {
  PathStat,
  ActivityInterval,
  ActivityStat,
  FlowPass,
  GNode,
  LogEvent,
  ProcessGraph,
  ResourceStat,
  Scenario,
  SimResult,
  Stats,
  ValueClass,
} from './types'

interface Ev {
  t: number
  seq: number
  fn: () => void
}

class Heap {
  private a: Ev[] = []
  get size() {
    return this.a.length
  }
  push(e: Ev) {
    const a = this.a
    a.push(e)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (less(a[p], a[i])) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): Ev | undefined {
    const a = this.a
    if (!a.length) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && less(a[l], a[m])) m = l
        if (r < a.length && less(a[r], a[m])) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

function less(x: Ev, y: Ev) {
  return x.t < y.t || (x.t === y.t && x.seq < y.seq)
}

type TokenState = 'active' | 'work' | 'delay' | 'join' | 'sub'

interface Token {
  id: number
  scope: ScopeInst
  node: string
  state: TokenState
  alive: boolean
  activity?: ActivityInst
  child?: ScopeInst
}

interface ScopeInst {
  id: number
  caseId: number
  nodeId: string | null
  parent?: Token
  tokens: Set<Token>
  alive: boolean
  pendingBoundary?: string
}

interface WorkItem {
  act: ActivityInst
  enqueued: number
  start?: number
  end?: number
  work?: number
  queued: boolean
  done: boolean
  resource?: Pool
}

interface ActivityInst {
  token: Token
  node: GNode
  arrive: number
  items: WorkItem[]
  remaining: number
  sequentialLeft: number
  done: boolean
  /** boundary event chosen to occur during processing */
  pending?: string
}

interface Pool {
  id: string
  name: string
  count: number
  free: number
  costPerHour: number
  cal: Calendar
  queue: WorkItem[]
  busy: number
}

interface CaseRec {
  id: number
  arrive: number
  end?: number
  waiting: number
  processing: number
  cost: number
  revenue: number
  balked?: boolean
  path: string[]
  root: ScopeInst
  /** working intervals [start, end, class] for the value stream */
  segs: [number, number, number][]
  /** activities completed at least once (later runs are rework) */
  doneActs: Set<string>
}

/** Order in which overlapping work counts towards the lead time. */
const FLOW_CLASSES = ['va', 'bva', 'rework', 'nva', 'none'] as const

interface ActAcc {
  count: number
  waiting: number[]
  processing: number[]
  cost: number
  revenue: number
  balked: number
}

export interface SimOptions {
  /** cases recorded for the animation (intervals + flow passes) */
  traceCases?: number
  maxEvents?: number
  /** cases written into the event log */
  logCases?: number
  /** 'keyed' (default): common random numbers per case and source; 'single': one stream */
  rng?: RngMode
  /** cases generated at most when simulating a period of time (default 20000) */
  maxCases?: number
}

export function stats(values: number[]): Stats {
  if (!values.length) return { mean: 0, median: 0, p90: 0, min: 0, max: 0, sum: 0, count: 0 }
  const s = [...values].sort((a, b) => a - b)
  const q = (p: number) => {
    const r = (s.length - 1) * p
    const lo = Math.floor(r)
    const hi = Math.ceil(r)
    return s[lo] + (s[hi] - s[lo]) * (r - lo)
  }
  const sum = s.reduce((a, b) => a + b, 0)
  return { mean: sum / s.length, median: q(0.5), p90: q(0.9), min: s[0], max: s[s.length - 1], sum, count: s.length }
}

function reachability(graph: ProcessGraph): Map<string, Set<string>> {
  const succ = new Map<string, string[]>()
  for (const n of Object.values(graph.nodes)) {
    const next = n.outgoing.map((f) => graph.flows[f].target).concat(n.boundaries)
    succ.set(n.id, next)
  }
  const out = new Map<string, Set<string>>()
  for (const id of Object.keys(graph.nodes)) {
    const seen = new Set<string>()
    const stack = [...(succ.get(id) ?? [])]
    while (stack.length) {
      const x = stack.pop()!
      if (seen.has(x)) continue
      seen.add(x)
      for (const y of succ.get(x) ?? []) stack.push(y)
    }
    out.set(id, seen)
  }
  return out
}

/** Normalised branch probabilities for a weighted split; missing ones share the remainder. */
export function branchProbabilities(graph: ProcessGraph, scenario: Scenario, nodeId: string): Record<string, number> {
  const flows = branchFlows(graph, nodeId)
  const res: Record<string, number> = {}
  if (!flows.length) return res
  const n = graph.nodes[nodeId]
  if (n.kind === 'or' || (n.kind !== 'xor' && n.kind !== 'eventGateway' && n.kind !== 'complex')) {
    for (const f of flows) res[f.id] = Math.min(1, Math.max(0, scenario.flows[f.id] ?? (f.id === n.defaultFlow ? 0.5 : 0.5)))
    return res
  }
  let known = 0
  const unknown: string[] = []
  for (const f of flows) {
    const p = scenario.flows[f.id]
    if (p === undefined || isNaN(p)) unknown.push(f.id)
    else {
      res[f.id] = Math.max(0, p)
      known += Math.max(0, p)
    }
  }
  const rest = Math.max(0, 1 - known)
  for (const id of unknown) res[id] = unknown.length ? rest / unknown.length : 0
  const total = Object.values(res).reduce((a, b) => a + b, 0)
  for (const id of Object.keys(res)) res[id] = total > 0 ? res[id] / total : 1 / flows.length
  return res
}

export function simulate(graph: ProcessGraph, scenario: Scenario, opts: SimOptions = {}): SimResult {
  const traceCases = opts.traceCases ?? 300
  const logCases = opts.logCases ?? 5000
  const maxEvents = opts.maxEvents ?? 3_000_000
  const draw = randomSource(scenario.seed || 1, opts.rng)
  const warmup = Math.max(0, scenario.warmup ?? 0)
  const offset = weekOffset(scenario.startDate)
  const warnings = [...graph.warnings]
  const reach = reachability(graph)
  const heap = new Heap()
  let seq = 0
  let now = 0
  let tokenSeq = 0
  let scopeSeq = 0
  let events = 0
  const at = (t: number, fn: () => void) => heap.push({ t: Math.max(t, now), seq: seq++, fn })

  const tables = new Map(scenario.timetables.map((t) => [t.id, t]))
  const pools = new Map<string, Pool>()
  for (const r of scenario.resources) {
    pools.set(r.id, {
      id: r.id,
      name: r.name,
      count: Math.max(0, Math.floor(r.count)),
      free: Math.max(0, Math.floor(r.count)),
      costPerHour: r.costPerHour || 0,
      cal: new Calendar(tables.get(r.timetableId), offset),
      queue: [],
      busy: 0,
    })
  }

  const cases: CaseRec[] = []
  const acc = new Map<string, ActAcc>()
  const intervals: ActivityInterval[] = []
  const passes: FlowPass[] = []
  const log: LogEvent[] = []
  const pendingOr = new Map<ScopeInst, Set<string>>()
  const subIntervals = new Map<ScopeInst, ActivityInterval>()
  const warned = new Set<string>()
  const warnOnce = (key: string, msg: string) => {
    if (warned.has(key)) return
    warned.add(key)
    warnings.push(msg)
  }
  const linkTargets = new Map<string, string>()
  for (const n of Object.values(graph.nodes)) {
    if (n.kind === 'catch' && n.eventDef === 'link') linkTargets.set(`${n.parent}|${n.linkName ?? n.name}`, n.id)
  }

  const params = (id: string) => scenario.elements[id] ?? {}
  const caseOf = (s: ScopeInst) => cases[s.caseId]
  const traced = (caseId: number) => caseId < traceCases

  function newToken(scope: ScopeInst, node: string): Token {
    const tk: Token = { id: tokenSeq++, scope, node, state: 'active', alive: true }
    scope.tokens.add(tk)
    return tk
  }

  function consume(tk: Token) {
    if (!tk.alive) return
    tk.alive = false
    tk.scope.tokens.delete(tk)
    afterChange(tk.scope)
  }

  function afterChange(scope: ScopeInst) {
    if (!scope.alive) return
    if (pendingOr.get(scope)?.size) at(now, () => checkOrJoins(scope))
    if (scope.tokens.size === 0) {
      at(now, () => {
        if (scope.alive && scope.tokens.size === 0) finishScope(scope)
      })
    }
  }

  function finishScope(scope: ScopeInst) {
    scope.alive = false
    pendingOr.delete(scope)
    if (!scope.parent) {
      const c = caseOf(scope)
      c.end = now
      return
    }
    const parentTk = scope.parent
    if (!parentTk.alive) return
    const node = graph.nodes[parentTk.node]
    const b = scope.pendingBoundary
    closeSub(scope)
    parentTk.child = undefined
    if (b && graph.nodes[b]) {
      const bn = graph.nodes[b]
      if (bn.cancelActivity) {
        exitVia(parentTk, b)
        return
      }
      spawnFrom(parentTk.scope, b)
    }
    leave(parentTk, node)
  }

  function closeSub(scope: ScopeInst) {
    const iv = subIntervals.get(scope)
    if (iv && iv.end === Infinity) iv.end = now
  }

  function cancelScope(scope: ScopeInst) {
    closeSub(scope)
    scope.alive = false
    pendingOr.delete(scope)
    for (const tk of [...scope.tokens]) killToken(tk)
    scope.tokens.clear()
  }

  function killToken(tk: Token) {
    if (!tk.alive) return
    tk.alive = false
    if (tk.activity) cancelActivity(tk.activity)
    if (tk.child) cancelScope(tk.child)
    tk.scope.tokens.delete(tk)
  }

  function cancelActivity(a: ActivityInst) {
    if (a.done) return
    a.done = true
    for (const it of a.items) {
      if (it.done) continue
      it.done = true
      if (it.queued && it.resource) {
        const q = it.resource.queue
        const i = q.indexOf(it)
        if (i >= 0) q.splice(i, 1)
      } else if (it.start !== undefined && it.resource) {
        const worked = it.resource.cal.workingBetween(it.start, Math.max(it.start, now))
        it.resource.busy += warmup > 0 ? it.resource.cal.workingBetween(Math.max(it.start, warmup), Math.max(it.start, now)) : worked
        record(a, it, Math.max(it.start, now), worked)
        releaseUnit(it.resource)
      }
    }
  }

  function enter(scope: ScopeInst, nodeId: string, viaFlow?: string, depth = 0) {
    if (!scope.alive) return
    if (viaFlow && traced(scope.caseId)) passes.push({ t: now, flow: viaFlow, caseId: scope.caseId })
    const node = graph.nodes[nodeId]
    if (!node) return
    const tk = newToken(scope, nodeId)
    if (depth > 200) {
      warnOnce('loop', 'A loop without any duration was cut off. Give one of its tasks a duration.')
      consume(tk)
      return
    }
    arrive(tk, node, depth)
  }

  function arrive(tk: Token, node: GNode, depth: number) {
    switch (node.kind) {
      case 'task':
        startActivity(tk, node)
        return
      case 'subprocess':
        if (!node.starts.length) {
          startActivity(tk, node)
          return
        }
        startSubprocess(tk, node)
        return
      case 'and':
        if (node.incoming.length > 1) {
          andJoin(tk, node)
          return
        }
        leave(tk, node, depth)
        return
      case 'or':
        if (node.incoming.length > 1) {
          tk.state = 'join'
          let set = pendingOr.get(tk.scope)
          if (!set) pendingOr.set(tk.scope, (set = new Set()))
          set.add(node.id)
          at(now, () => checkOrJoins(tk.scope))
          return
        }
        leave(tk, node, depth)
        return
      case 'catch': {
        if (node.eventDef === 'link') {
          leave(tk, node, depth)
          return
        }
        const p = params(node.id)
        const d = p.duration ? sample(p.duration, draw('c:' + node.id, tk.scope.caseId)) : (node.timerDuration ?? 0)
        if (d > 0) {
          delay(tk, node, d)
          return
        }
        leave(tk, node, depth)
        return
      }
      case 'throw':
        if (node.eventDef === 'link') {
          const target = linkTargets.get(`${node.parent}|${node.linkName ?? node.name}`)
          consume(tk)
          if (target) enter(tk.scope, target, undefined, depth + 1)
          else warnOnce('link' + node.id, `Link event "${node.name}" has no matching catch event.`)
          return
        }
        leave(tk, node, depth)
        return
      case 'end':
        endEvent(tk, node)
        return
      case 'start':
      case 'boundary':
        leave(tk, node, depth)
        return
      default:
        leave(tk, node, depth)
    }
  }

  function endEvent(tk: Token, node: GNode) {
    const scope = tk.scope
    if (node.eventDef === 'terminate') {
      consume(tk)
      cancelScope(scope)
      if (!scope.parent) caseOf(scope).end = now
      else {
        scope.alive = true
        finishScope(scope)
      }
      return
    }
    if ((node.eventDef === 'error' || node.eventDef === 'escalation' || node.eventDef === 'cancel') && scope.parent) {
      const parentTk = scope.parent
      const sub = graph.nodes[parentTk.node]
      const b = sub.boundaries.find((id) => graph.nodes[id].eventDef === node.eventDef) ??
        sub.boundaries.find((id) => graph.nodes[id].eventDef === 'error')
      if (b) {
        consume(tk)
        cancelScope(scope)
        exitVia(parentTk, b)
        return
      }
    }
    consume(tk)
  }

  function delay(tk: Token, node: GNode, d: number) {
    tk.state = 'delay'
    const start = now
    at(now + d, () => {
      if (!tk.alive) return
      if (traced(tk.scope.caseId)) intervals.push({ node: node.id, caseId: tk.scope.caseId, arrive: start, start, end: now })
      tk.state = 'active'
      leave(tk, node)
    })
  }

  function chooseFlows(node: GNode, caseId: number): string[] {
    const outs = node.outgoing
    if (outs.length === 0) return []
    const weighted = branchFlows(graph, node.id)
    if (!weighted.length) return outs
    const probs = branchProbabilities(graph, scenario, node.id)
    const g = draw('g:' + node.id, caseId)
    if (node.kind === 'xor' || node.kind === 'eventGateway' || node.kind === 'complex') {
      let u = g()
      for (const f of weighted) {
        u -= probs[f.id]
        if (u < 0) return [f.id]
      }
      return [weighted[weighted.length - 1].id]
    }
    const chosen = weighted.filter((f) => f.id !== node.defaultFlow && g() < probs[f.id]).map((f) => f.id)
    if (chosen.length) return chosen
    if (node.defaultFlow) return [node.defaultFlow]
    const best = weighted.reduce((a, b) => (probs[b.id] > probs[a.id] ? b : a))
    return [best.id]
  }

  function leave(tk: Token, node: GNode, depth = 0) {
    if (!tk.alive) return
    const scope = tk.scope
    const flows = chooseFlows(node, scope.caseId)
    tk.alive = false
    scope.tokens.delete(tk)
    for (const f of flows) enter(scope, graph.flows[f].target, f, depth + 1)
    afterChange(scope)
  }

  function spawnFrom(scope: ScopeInst, boundaryId: string) {
    const b = graph.nodes[boundaryId]
    for (const f of b.outgoing) enter(scope, graph.flows[f].target, f)
  }

  function exitVia(tk: Token, boundaryId: string) {
    if (!tk.alive) return
    if (tk.activity) cancelActivity(tk.activity)
    if (tk.child) cancelScope(tk.child)
    const scope = tk.scope
    tk.alive = false
    scope.tokens.delete(tk)
    spawnFrom(scope, boundaryId)
    afterChange(scope)
  }

  function andJoin(tk: Token, node: GNode) {
    tk.state = 'join'
    const waiting = [...tk.scope.tokens].filter((t) => t.state === 'join' && t.node === node.id)
    if (waiting.length < node.incoming.length) return
    const keep = waiting[0]
    for (const w of waiting.slice(1, node.incoming.length)) {
      w.alive = false
      tk.scope.tokens.delete(w)
    }
    keep.state = 'active'
    leave(keep, node)
  }

  function checkOrJoins(scope: ScopeInst) {
    if (!scope.alive) return
    const set = pendingOr.get(scope)
    if (!set) return
    for (const joinId of [...set]) {
      const waiting = [...scope.tokens].filter((t) => t.state === 'join' && t.node === joinId)
      if (!waiting.length) {
        set.delete(joinId)
        continue
      }
      const blocked = [...scope.tokens].some(
        (t) => !(t.state === 'join' && t.node === joinId) && reach.get(t.node)?.has(joinId),
      )
      if (blocked) continue
      set.delete(joinId)
      const keep = waiting[0]
      for (const w of waiting.slice(1)) {
        w.alive = false
        scope.tokens.delete(w)
      }
      keep.state = 'active'
      leave(keep, graph.nodes[joinId])
    }
  }

  function setupBoundaries(tk: Token, node: GNode, a: ActivityInst | undefined, child?: ScopeInst) {
    let chosen: string | undefined
    for (const bId of node.boundaries) {
      const b = graph.nodes[bId]
      const p = params(bId)
      if (b.eventDef === 'timer') {
        const d = p.duration ? sample(p.duration, draw('b:' + bId, tk.scope.caseId)) : b.timerDuration
        if (d === undefined) continue
        at(now + d, () => {
          if (!tk.alive || (a && a.done) || (child && !child.alive)) return
          if (b.cancelActivity) exitVia(tk, bId)
          else spawnFrom(tk.scope, bId)
        })
      } else if (!chosen && p.probability && draw('b:' + bId, tk.scope.caseId)() < p.probability) {
        chosen = bId
      }
    }
    if (chosen) {
      if (a) a.pending = chosen
      if (child) child.pendingBoundary = chosen
    }
  }

  function startSubprocess(tk: Token, node: GNode) {
    tk.state = 'sub'
    const child: ScopeInst = {
      id: scopeSeq++,
      caseId: tk.scope.caseId,
      nodeId: node.id,
      parent: tk,
      tokens: new Set(),
      alive: true,
    }
    tk.child = child
    setupBoundaries(tk, node, undefined, child)
    const arriveAt = now
    const p = params(node.id)
    if (traced(tk.scope.caseId)) {
      const caseId = tk.scope.caseId
      const iv: ActivityInterval = { node: node.id, caseId, arrive: arriveAt, start: arriveAt, end: Infinity }
      intervals.push(iv)
      subIntervals.set(child, iv)
    }
    if (p.fixedCost) caseOf(tk.scope).cost += p.fixedCost
    for (const s of node.starts) enter(child, s)
  }

  function startActivity(tk: Token, node: GNode) {
    tk.state = 'work'
    const p = params(node.id)
    let n = 1
    if (node.multiInstance) n = Math.max(1, Math.round(p.instances ?? node.multiInstance.cardinality ?? 3))
    const sequential = !!node.multiInstance?.sequential
    const a: ActivityInst = {
      token: tk,
      node,
      arrive: now,
      items: [],
      remaining: n,
      sequentialLeft: sequential ? n - 1 : 0,
      done: false,
    }
    tk.activity = a
    setupBoundaries(tk, node, a)
    if (p.fixedCost) caseOf(tk.scope).cost += p.fixedCost
    if (!acc.has(node.id)) acc.set(node.id, { count: 0, waiting: [], processing: [], cost: p.fixedCost ?? 0, revenue: 0, balked: 0 })
    else acc.get(node.id)!.cost += p.fixedCost ?? 0
    const parallel = sequential ? 1 : n
    for (let i = 0; i < parallel; i++) request(a)
  }

  function request(a: ActivityInst) {
    const p = params(a.node.id)
    const item: WorkItem = { act: a, enqueued: now, queued: true, done: false }
    a.items.push(item)
    const pool = p.resourceId ? pools.get(p.resourceId) : undefined
    if (p.resourceId && !pool) warnOnce('res' + p.resourceId, `"${a.node.name}" uses a resource that no longer exists; it runs without one.`)
    if (!p.duration && a.node.kind === 'task') {
      warnOnce('dur' + a.node.id, `"${a.node.name || a.node.id}" has no duration yet and takes no time.`)
    }
    if (pool && pool.count === 0) {
      warnOnce('zero' + pool.id, `Resource "${pool.name}" has 0 people, so its tasks never start.`)
    }
    if (!pool) {
      beginWork(item, undefined)
      return
    }
    if (p.maxQueue !== undefined && pool.free === 0 && pool.queue.length >= p.maxQueue) {
      const c = caseOf(a.token.scope)
      c.balked = true
      c.end = now
      acc.get(a.node.id)!.balked++
      cancelScope(c.root)
      return
    }
    item.resource = pool
    if (pool.free > 0) {
      pool.free--
      beginWork(item, pool)
    } else pool.queue.push(item)
  }

  function releaseUnit(pool: Pool) {
    while (pool.queue.length) {
      const next = pool.queue.shift()!
      if (next.done) continue
      beginWork(next, pool)
      return
    }
    pool.free++
  }

  function beginWork(item: WorkItem, pool: Pool | undefined) {
    item.queued = false
    const a = item.act
    const p = params(a.node.id)
    const work = p.duration ? sample(p.duration, draw('a:' + a.node.id, a.token.scope.caseId)) : 0
    const start = pool ? pool.cal.nextWorking(now) : now
    let end = pool ? pool.cal.addWorking(start, work) : start + work
    item.start = start
    item.work = work
    let boundary: string | undefined
    if (a.pending && a.items.length === 1) {
      const b = graph.nodes[a.pending]
      const frac = b.eventDef === 'error' ? 1 : draw('f:' + b.id, a.token.scope.caseId)()
      const cut = pool ? pool.cal.addWorking(start, work * frac) : start + work * frac
      end = cut
      item.work = work * frac
      boundary = a.pending
      if (!b.cancelActivity) {
        const bId = a.pending
        a.pending = undefined
        boundary = undefined
        at(cut, () => {
          if (a.token.alive && !a.done) spawnFrom(a.token.scope, bId)
        })
        end = pool ? pool.cal.addWorking(start, work) : start + work
        item.work = work
      }
    }
    item.end = end
    at(end, () => {
      if (item.done) return
      item.done = true
      if (pool) pool.busy += warmup > 0 ? pool.cal.workingBetween(Math.max(start, warmup), end) : (item.work ?? 0)
      record(a, item, end, item.work ?? 0)
      const rv = params(a.node.id).revenue
      if (rv && !boundary) {
        caseOf(a.token.scope).revenue += rv
        acc.get(a.node.id)!.revenue += rv
      }
      if (pool) releaseUnit(pool)
      if (boundary) {
        a.done = true
        exitVia(a.token, boundary)
        return
      }
      a.remaining--
      if (a.sequentialLeft > 0) {
        a.sequentialLeft--
        request(a)
        return
      }
      if (a.remaining > 0) return
      a.done = true
      caseOf(a.token.scope).doneActs.add(a.node.id)
      const rp = params(a.node.id).repeatProbability ?? (a.node.loop ? 0.2 : 0)
      const tk = a.token
      if (rp > 0 && draw('r:' + a.node.id, tk.scope.caseId)() < rp) {
        if (!tk.alive) return
        tk.activity = undefined
        startActivity(tk, a.node)
        return
      }
      tk.activity = undefined
      tk.state = 'active'
      leave(tk, a.node)
    })
  }

  function record(a: ActivityInst, item: WorkItem, end: number, work: number) {
    const st = acc.get(a.node.id)!
    const c = caseOf(a.token.scope)
    const wait = Math.max(0, (item.start ?? now) - item.enqueued)
    const cost = item.resource ? (work / 3600) * item.resource.costPerHour : 0
    if (c.arrive >= warmup) {
      st.count++
      st.waiting.push(wait)
      st.processing.push(work)
      st.cost += cost
      const cls = c.doneActs.has(a.node.id) ? 'rework' : (params(a.node.id).value ?? 'none')
      const k = FLOW_CLASSES.indexOf(cls)
      const s0 = item.start ?? now
      for (const [x, y] of item.resource ? item.resource.cal.segments(s0, end) : [[s0, end]]) if (y > x) c.segs.push([x, y, k])
    }
    c.waiting += wait
    c.processing += work
    c.cost += cost
    if (!c.path.includes(a.node.id)) c.path.push(a.node.id)
    if (traced(c.id)) {
      intervals.push({ node: a.node.id, caseId: c.id, arrive: item.enqueued, start: item.start ?? now, end })
    }
    if (c.id < logCases) {
      log.push({
        caseId: c.id,
        activity: a.node.name || a.node.id,
        activityId: a.node.id,
        resource: item.resource?.name ?? '',
        start: item.start ?? now,
        end,
      })
    }
  }

  // arrivals
  const start = graph.starts[0]
  const horizon = scenario.horizon && scenario.horizon > 0 ? scenario.horizon : 0
  const total = horizon ? Math.max(1, Math.floor(opts.maxCases ?? 20000)) : Math.max(0, Math.floor(scenario.cases))
  const arrivalCal = scenario.arrivalTimetableId ? new Calendar(tables.get(scenario.arrivalTimetableId), offset) : undefined
  if (start) {
    let t = arrivalCal ? arrivalCal.nextWorking(0) : 0
    for (let i = 0; i < total; i++) {
      if (horizon && t >= horizon) break
      const id = i
      const arriveAt = t
      at(arriveAt, () => {
        const root: ScopeInst = { id: scopeSeq++, caseId: id, nodeId: null, tokens: new Set(), alive: true }
        cases[id] = { id, arrive: now, waiting: 0, processing: 0, cost: 0, revenue: 0, path: [], root, segs: [], doneActs: new Set() }
        enter(root, start)
      })
      t += sample(scenario.arrival, draw('arrival', i))
      if (arrivalCal) t = arrivalCal.nextWorking(t)
    }
  }

  while (heap.size) {
    const e = heap.pop()!
    now = e.t
    e.fn()
    if (++events > maxEvents) {
      warnings.push('The simulation was stopped after too many steps. Check for endless loops or reduce the number of cases.')
      break
    }
  }

  for (const iv of subIntervals.values()) if (iv.end === Infinity) iv.end = now

  const finished = cases.filter((c) => c && c.end !== undefined && !c.balked)
  const done = warmup > 0 ? finished.filter((c) => c.arrive >= warmup) : finished
  const balked = cases.filter((c) => c?.balked).length
  const stuck = cases.filter((c) => c && c.end === undefined).length
  if (stuck) warnings.push(`${stuck} case(s) did not finish (for example waiting at a gateway that never receives all its branches).`)
  done.sort((a, b) => a.arrive - b.arrive)
  const cut = Math.floor(done.length * Math.min(0.4, Math.max(0, scenario.trim || 0)))
  const kept = done.slice(cut, done.length - cut || undefined)
  const cycles = kept.map((c) => c.end! - c.arrive)
  const lastEnd = done.reduce((m, c) => Math.max(m, c.end!), 0)
  const firstArrive = done.reduce((m, c) => Math.min(m, c.arrive), Infinity)
  const span = !done.length ? 0 : warmup > 0 ? lastEnd - warmup : lastEnd - firstArrive
  const t0 = warmup > 0 ? warmup : done.length ? firstArrive : 0
  let area = 0
  for (const c of cases) {
    if (!c) continue
    const e = Math.min(c.end ?? lastEnd, lastEnd)
    area += Math.max(0, e - Math.max(c.arrive, t0))
  }
  const wip = lastEnd > t0 ? area / (lastEnd - t0) : 0
  const flowSum = { va: 0, bva: 0, nva: 0, rework: 0, none: 0, wait: 0 }
  for (const c of kept) {
    const f = flowOf(c)
    for (const k of Object.keys(flowSum) as (keyof typeof flowSum)[]) flowSum[k] += f[k]
  }
  for (const k of Object.keys(flowSum) as (keyof typeof flowSum)[]) flowSum[k] = kept.length ? flowSum[k] / kept.length : 0

  const activities: ActivityStat[] = []
  for (const n of Object.values(graph.nodes)) {
    if (n.kind !== 'task' && !(n.kind === 'subprocess' && !n.starts.length)) continue
    const st = acc.get(n.id) ?? { count: 0, waiting: [], processing: [], cost: 0, revenue: 0, balked: 0 }
    activities.push({
      id: n.id,
      name: n.name || n.id,
      count: st.count,
      waiting: stats(st.waiting),
      processing: stats(st.processing),
      cost: st.cost,
      revenue: st.revenue,
      balked: st.balked,
      resourceId: params(n.id).resourceId,
      value: params(n.id).value,
    })
  }
  const end = span
  const resources: ResourceStat[] = [...pools.values()].map((p) => {
    const avail = p.cal.workingBetween(warmup > 0 ? warmup : 0, Math.max((warmup > 0 ? warmup : 0) + end, 1)) * p.count
    return {
      id: p.id,
      name: p.name,
      count: p.count,
      busySeconds: p.busy,
      availableSeconds: avail,
      utilisation: avail > 0 ? Math.min(1, p.busy / avail) : 0,
      cost: (p.busy / 3600) * p.costPerHour,
      paidCost: (avail / 3600) * p.costPerHour,
    }
  })

  const groups = new Map<string, CaseRec[]>()
  for (const c of kept) {
    const key = c.path.join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }
  const common = kept.length ? kept[0].path.filter((id) => kept.every((c) => c.path.includes(id))) : []
  const paths: PathStat[] = [...groups.entries()]
    .map(([key, list]) => {
      const own = list[0].path.filter((id) => !common.includes(id)).map((id) => graph.nodes[id]?.name || id)
      return {
        key,
        label: own.length ? own.join(', ') : groups.size > 1 ? 'Shortest path' : 'All cases',
        count: list.length,
        share: list.length / kept.length,
        cycle: stats(list.map((c) => c.end! - c.arrive)),
        waiting: stats(list.map((c) => c.waiting)),
        revenue: list.reduce((a, c) => a + c.revenue, 0),
      }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)

  const cs = stats(cycles)
  const bins = 20
  const histogram: SimResult['histogram'] = []
  if (cycles.length) {
    const lo = cs.min
    const hi = cs.max > lo ? cs.max : lo + 1
    const w = (hi - lo) / bins
    for (let i = 0; i < bins; i++) histogram.push({ from: lo + i * w, to: lo + (i + 1) * w, count: 0 })
    for (const v of cycles) histogram[Math.min(bins - 1, Math.floor((v - lo) / w))].count++
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    startDate: scenario.startDate,
    currency: scenario.currency,
    casesStarted: cases.filter(Boolean).length,
    casesCompleted: done.length,
    casesBalked: balked,
    span,
    cycle: cs,
    waiting: stats(kept.map((c) => c.waiting)),
    processing: stats(kept.map((c) => c.processing)),
    cost: stats(kept.map((c) => c.cost)),
    throughputPerDay: span > 0 ? (done.length / span) * 86400 : 0,
    throughputPerHour: span > 0 ? (done.length / span) * 3600 : 0,
    revenue: stats(kept.map((c) => c.revenue)),
    paths,
    activities,
    resources,
    histogram,
    intervals,
    passes,
    log,
    warnings,
    wip,
    flow: flowSum,
  }
}

/**
 * Splits a case's lead time into value-adding, business value-adding, rework, waste,
 * unclassified work and waiting. Where activities overlap (parallel branches), the instant
 * counts once, for the highest class in FLOW_CLASSES; time without any work is waiting.
 */
function flowOf(c: CaseRec): Record<ValueClass | 'rework' | 'none' | 'wait', number> {
  const out = { va: 0, bva: 0, nva: 0, rework: 0, none: 0, wait: 0 }
  const a = c.arrive
  const b = c.end ?? a
  const pts = new Set<number>([a, b])
  for (const [x, y] of c.segs) {
    pts.add(Math.min(b, Math.max(a, x)))
    pts.add(Math.min(b, Math.max(a, y)))
  }
  const ts = [...pts].sort((p, q) => p - q)
  for (let i = 0; i + 1 < ts.length; i++) {
    const lo = ts[i]
    const hi = ts[i + 1]
    let best: number = FLOW_CLASSES.length
    for (const [x, y, k] of c.segs) if (x <= lo && y >= hi && k < best) best = k
    out[best < FLOW_CLASSES.length ? FLOW_CLASSES[best as 0] : 'wait'] += hi - lo
  }
  return out
}
