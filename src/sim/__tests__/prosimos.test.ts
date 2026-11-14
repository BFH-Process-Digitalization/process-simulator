import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { buildGraph } from '../graph'
import { simulate } from '../engine'
import { fromProsimos, toProsimos } from '../prosimos'
import type { Scenario } from '../types'

;(globalThis as unknown as { DOMParser: unknown }).DOMParser ??= DOMParser

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="x">
  <bpmn:process id="p">
    <bpmn:startEvent id="s" /><bpmn:task id="a" name="A" /><bpmn:exclusiveGateway id="g" />
    <bpmn:task id="b" name="B" /><bpmn:task id="c" name="C" /><bpmn:exclusiveGateway id="j" /><bpmn:endEvent id="e" />
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="a" /><bpmn:sequenceFlow id="f2" sourceRef="a" targetRef="g" />
    <bpmn:sequenceFlow id="f3" sourceRef="g" targetRef="b" /><bpmn:sequenceFlow id="f4" sourceRef="g" targetRef="c" />
    <bpmn:sequenceFlow id="f5" sourceRef="b" targetRef="j" /><bpmn:sequenceFlow id="f6" sourceRef="c" targetRef="j" />
    <bpmn:sequenceFlow id="f7" sourceRef="j" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`

const office = { id: 'office', name: 'Office', rules: [{ fromDay: 0, toDay: 4, from: '08:00', to: '17:00' }] }
const scenario: Scenario = {
  id: 'baseline',
  name: 'Baseline',
  cases: 500,
  arrival: { type: 'exponential', mean: 600, unit: 'seconds' },
  arrivalTimetableId: 'office',
  startDate: '2026-01-05T00:00:00',
  currency: 'CHF',
  resources: [{ id: 'clerk', name: 'Clerk', count: 2, costPerHour: 50, timetableId: 'office' }],
  timetables: [office],
  elements: {
    a: { duration: { type: 'lognormal', mean: 600, sd: 300, unit: 'seconds' }, resourceId: 'clerk' },
    b: { duration: { type: 'gamma', mean: 300, sd: 100, unit: 'seconds' }, resourceId: 'clerk' },
    c: { duration: { type: 'uniform', mean: 300, min: 200, max: 400, unit: 'seconds' }, resourceId: 'clerk' },
  },
  flows: { f3: 0.4, f4: 0.6 },
  trim: 0,
  seed: 3,
}

describe('Prosimos parameters', () => {
  const { graph } = buildGraph(xml)

  it('round-trips a scenario', () => {
    const out = toProsimos(graph, scenario)
    expect(out.unsupported).toEqual([])
    const back = fromProsimos(graph, out.params, 500, scenario.startDate).scenario
    expect(back.flows).toEqual({ f3: 0.4, f4: 0.6 })
    expect(back.elements.a.duration).toEqual(scenario.elements.a.duration)
    expect(back.elements.b.duration).toEqual(scenario.elements.b.duration)
    expect(back.resources[0]).toMatchObject({ id: 'clerk', count: 2, costPerHour: 50, timetableId: 'office' })
    expect(back.timetables.find((t) => t.id === back.arrivalTimetableId)?.rules).toEqual(office.rules)
    const r1 = simulate(graph, scenario)
    const r2 = simulate(graph, { ...back, seed: 3 })
    expect(r2.cycle.mean).toBeCloseTo(r1.cycle.mean, 6)
  })

  it('only lets cases arrive while the arrival timetable is open', () => {
    const r = simulate(graph, scenario, { logCases: 500 })
    const starts = r.log.filter((e) => e.activity === 'A').map((e) => new Date(e.start))
    expect(starts.length).toBeGreaterThan(0)
    for (const d of starts) {
      expect(d.getUTCDay()).toBeGreaterThanOrEqual(1)
      expect(d.getUTCDay()).toBeLessThanOrEqual(5)
    }
  })
})
