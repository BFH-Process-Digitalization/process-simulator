import { DOMParser } from '@xmldom/xmldom'
import { parseIsoDuration } from './time'
import type { EventDef, GFlow, GNode, NodeKind, ProcessGraph } from './types'

type El = Element

const TASKS = new Set([
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'businessRuleTask',
  'scriptTask',
  'callActivity',
])
const SUBPROCESSES = new Set(['subProcess', 'transaction', 'adHocSubProcess'])
const GATEWAYS: Record<string, NodeKind> = {
  exclusiveGateway: 'xor',
  parallelGateway: 'and',
  inclusiveGateway: 'or',
  eventBasedGateway: 'eventGateway',
  complexGateway: 'complex',
}
const EVENTS: Record<string, NodeKind> = {
  startEvent: 'start',
  endEvent: 'end',
  intermediateCatchEvent: 'catch',
  intermediateThrowEvent: 'throw',
  boundaryEvent: 'boundary',
}
const DEFS: Record<string, EventDef> = {
  timerEventDefinition: 'timer',
  messageEventDefinition: 'message',
  errorEventDefinition: 'error',
  escalationEventDefinition: 'escalation',
  signalEventDefinition: 'signal',
  conditionalEventDefinition: 'conditional',
  compensateEventDefinition: 'compensate',
  linkEventDefinition: 'link',
  terminateEventDefinition: 'terminate',
  cancelEventDefinition: 'cancel',
}

function children(el: El): El[] {
  const out: El[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as El)
  return out
}

function local(el: El): string {
  return el.localName || el.nodeName.replace(/^.*:/, '')
}

function text(el: El | undefined): string {
  return (el?.textContent ?? '').trim()
}

export function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document
}

export interface ParsedModel {
  graph: ProcessGraph
  processes: { id: string; name: string; tasks: number }[]
}

function processNames(doc: Document): Record<string, string> {
  const names: Record<string, string> = {}
  const all = doc.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    const el = all[i] as El
    if (local(el) === 'participant' && el.getAttribute('processRef')) {
      names[el.getAttribute('processRef')!] = el.getAttribute('name') ?? ''
    }
  }
  return names
}

function countTasks(el: El): number {
  let n = 0
  for (const c of children(el)) {
    if (TASKS.has(local(c))) n++
    if (SUBPROCESSES.has(local(c))) n += 1 + countTasks(c)
  }
  return n
}

/** Builds the simulation graph of one process (the one with the most tasks unless `processId` is given). */
export function buildGraph(xml: string, processId?: string): ParsedModel {
  const doc = parseXml(xml)
  const root = doc.documentElement as unknown as El
  if (!root || local(root) !== 'definitions') throw new Error('Not a BPMN 2.0 file (no <definitions> root).')
  const names = processNames(doc)
  const procEls = children(root).filter((c) => local(c) === 'process')
  if (procEls.length === 0) throw new Error('The file contains no <process>.')
  const processes = procEls.map((p) => ({
    id: p.getAttribute('id') ?? '',
    name: names[p.getAttribute('id') ?? ''] || p.getAttribute('name') || 'Process',
    tasks: countTasks(p),
  }))
  const chosen =
    procEls.find((p) => p.getAttribute('id') === processId) ??
    procEls.reduce((best, p) => (countTasks(p) > countTasks(best) ? p : best), procEls[0])

  const nodes: Record<string, GNode> = {}
  const flows: Record<string, GFlow> = {}
  const lanes: string[] = []
  const laneOf: Record<string, string> = {}
  const warnings: string[] = []

  const collectLanes = (laneSet: El) => {
    for (const lane of children(laneSet).filter((c) => local(c) === 'lane')) {
      const name = lane.getAttribute('name') || 'Lane'
      const nested = children(lane).filter((c) => local(c) === 'childLaneSet')
      if (nested.length) {
        nested.forEach(collectLanes)
        continue
      }
      if (!lanes.includes(name)) lanes.push(name)
      for (const ref of children(lane).filter((c) => local(c) === 'flowNodeRef')) laneOf[text(ref)] = name
    }
  }

  const walk = (container: El, parentId: string) => {
    for (const el of children(container)) {
      const t = local(el)
      const id = el.getAttribute('id') ?? ''
      if (t === 'laneSet') {
        collectLanes(el)
        continue
      }
      if (t === 'sequenceFlow') {
        flows[id] = {
          id,
          name: el.getAttribute('name') ?? '',
          source: el.getAttribute('sourceRef') ?? '',
          target: el.getAttribute('targetRef') ?? '',
          conditional: children(el).some((c) => local(c) === 'conditionExpression'),
        }
        continue
      }
      let kind: NodeKind | undefined
      if (TASKS.has(t)) kind = 'task'
      else if (SUBPROCESSES.has(t)) kind = 'subprocess'
      else kind = GATEWAYS[t] ?? EVENTS[t]
      if (!kind) continue
      const kids = children(el)
      let eventDef: EventDef = 'none'
      let timerDuration: number | undefined
      let linkName: string | undefined
      for (const c of kids) {
        const d = DEFS[local(c)]
        if (!d) continue
        eventDef = d
        if (d === 'timer') {
          const dur = children(c).find((x) => local(x) === 'timeDuration')
          timerDuration = parseIsoDuration(text(dur))
        }
        if (d === 'link') linkName = c.getAttribute('name') ?? el.getAttribute('name') ?? ''
      }
      const mi = kids.find((c) => local(c) === 'multiInstanceLoopCharacteristics')
      const card = mi ? parseFloat(text(children(mi).find((x) => local(x) === 'loopCardinality'))) : NaN
      const node: GNode = {
        id,
        name: el.getAttribute('name') ?? '',
        type: t,
        kind,
        parent: parentId,
        incoming: [],
        outgoing: [],
        eventDef,
        timerDuration,
        attachedTo: el.getAttribute('attachedToRef') ?? undefined,
        cancelActivity: el.getAttribute('cancelActivity') !== 'false',
        boundaries: [],
        defaultFlow: el.getAttribute('default') ?? undefined,
        multiInstance: mi
          ? { sequential: mi.getAttribute('isSequential') === 'true', cardinality: isNaN(card) ? undefined : card }
          : undefined,
        loop: kids.some((c) => local(c) === 'standardLoopCharacteristics'),
        linkName,
        starts: [],
      }
      nodes[id] = node
      if (kind === 'subprocess') walk(el, id)
    }
  }
  walk(chosen, chosen.getAttribute('id') ?? 'process')

  for (const f of Object.values(flows)) {
    const s = nodes[f.source]
    const tg = nodes[f.target]
    if (!s || !tg) {
      delete flows[f.id]
      continue
    }
    s.outgoing.push(f.id)
    tg.incoming.push(f.id)
  }
  for (const n of Object.values(nodes)) {
    n.lane = laneOf[n.id]
    if (n.kind === 'boundary' && n.attachedTo && nodes[n.attachedTo]) nodes[n.attachedTo].boundaries.push(n.id)
  }
  for (const n of Object.values(nodes)) {
    if (n.kind === 'start' && n.incoming.length === 0) {
      const p = nodes[n.parent]
      if (p && p.kind === 'subprocess') p.starts.push(n.id)
    }
  }
  const processIdStr = chosen.getAttribute('id') ?? 'process'
  const starts = Object.values(nodes)
    .filter((n) => n.kind === 'start' && n.parent === processIdStr)
    .sort((a, b) => (a.eventDef === 'none' ? -1 : 0) - (b.eventDef === 'none' ? -1 : 0))
    .map((n) => n.id)
  if (starts.length === 0) warnings.push('The process has no start event, so no case can start.')
  for (const n of Object.values(nodes)) {
    if (n.kind === 'subprocess' && n.starts.length === 0) {
      warnings.push(`Subprocess "${n.name || n.id}" has no start event; it is treated as a task.`)
    }
  }
  if (procEls.length > 1) {
    warnings.push(
      `The file has ${procEls.length} pools; simulating "${processes.find((p) => p.id === processIdStr)?.name}". Message flows to other pools are modelled as waiting times.`,
    )
  }
  return {
    graph: {
      processId: processIdStr,
      name: processes.find((p) => p.id === processIdStr)?.name ?? 'Process',
      nodes,
      flows,
      starts,
      lanes,
      warnings,
    },
    processes,
  }
}

/** Outgoing flows of a node that act as branches the user can weight. */
export function branchFlows(graph: ProcessGraph, nodeId: string): GFlow[] {
  const n = graph.nodes[nodeId]
  if (!n) return []
  const outs = n.outgoing.map((f) => graph.flows[f])
  if (['xor', 'or', 'eventGateway', 'complex'].includes(n.kind)) return outs.length > 1 ? outs : []
  if (outs.length > 1 && outs.some((f) => f.conditional || f.id === n.defaultFlow)) return outs
  return []
}

export function isWeightedSplit(graph: ProcessGraph, nodeId: string): boolean {
  return branchFlows(graph, nodeId).length > 0
}
