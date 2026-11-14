import { buildGraph } from '../graph'
import { ALWAYS, OFFICE_HOURS, dist } from '../params'
import type { Scenario } from '../types'

export function bpmn(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="p">${body}</bpmn:process>
</bpmn:definitions>`
}

export function graphOf(body: string) {
  return buildGraph(bpmn(body)).graph
}

export function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: 'baseline',
    name: 'Baseline',
    cases: 10,
    arrival: dist('fixed', 3600, 'hours'),
    startDate: '2026-11-09T09:00:00.000Z',
    currency: 'CHF',
    resources: [],
    timetables: [OFFICE_HOURS, ALWAYS],
    elements: {},
    flows: {},
    trim: 0,
    seed: 7,
    ...over,
  }
}

export const fixed = (seconds: number) => dist('fixed', seconds, 'minutes')
