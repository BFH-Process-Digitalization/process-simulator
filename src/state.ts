import { buildGraph } from './sim/graph'
import { completeScenario, defaultScenario, type Project } from './sim/params'
import { readProject } from './sim/projectFile'
import type { ProcessGraph } from './sim/types'

export interface Saved {
  xml: string
  project: Project
  fileName: string
  scenarioId: string
}

const KEY = 'process-simulator:v1'

export function loadSaved(): Saved | undefined {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return undefined
    const s = JSON.parse(raw) as Saved
    if (s && typeof s.xml === 'string' && s.project?.baseline) return s
  } catch {
    return undefined
  }
  return undefined
}

export function save(s: Saved): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    return true
  } catch {
    return false
  }
}

/** Builds the project for a freshly opened file: the data saved by this tool, else defaults. */
export function projectFromFile(xml: string): { project: Project; graph: ProcessGraph; source: 'project' | 'defaults' } {
  const { graph } = buildGraph(xml)
  const own = readProject(xml)
  if (own) return { project: { ...own, baseline: completeScenario(graph, own.baseline) }, graph, source: 'project' }
  return { project: { baseline: defaultScenario(graph), variants: [] }, graph, source: 'defaults' }
}

export const BLANK = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="process" isExecutable="false">
    <bpmn:startEvent id="start" name="Start" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="diagram">
    <bpmndi:BPMNPlane id="plane" bpmnElement="process">
      <bpmndi:BPMNShape id="start_di" bpmnElement="start"><dc:Bounds x="180" y="160" width="36" height="36" /><bpmndi:BPMNLabel><dc:Bounds x="185" y="203" width="27" height="14" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`

export const EXAMPLE = { name: 'Coffee shop exercise', file: 'samples/coffee-shop.bpmn' }
