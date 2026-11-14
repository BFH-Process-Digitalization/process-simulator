import { describe, expect, it } from 'vitest'
import { simulate } from '../engine'
import { fixed, graphOf, scenario } from './helpers'

const seq = (id: string, s: string, t: string, extra = '') =>
  `<bpmn:sequenceFlow id="${id}" sourceRef="${s}" targetRef="${t}">${extra}</bpmn:sequenceFlow>`

describe('engine', () => {
  it('runs a linear process', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:task id="a" name="A"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'a')}${seq('f2', 'a', 'e')}`)
    const r = simulate(g, scenario({ elements: { a: { duration: fixed(600) } } }))
    expect(r.casesCompleted).toBe(10)
    expect(r.cycle.mean).toBeCloseTo(600)
    expect(r.activities[0].count).toBe(10)
  })

  it('queues cases when the resource is busy', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:task id="a"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'a')}${seq('f2', 'a', 'e')}`)
    const r = simulate(
      g,
      scenario({
        cases: 4,
        arrival: fixed(1800),
        resources: [{ id: 'r', name: 'Clerk', count: 1, costPerHour: 60, timetableId: 'always' }],
        elements: { a: { duration: fixed(3600), resourceId: 'r' } },
      }),
    )
    expect(r.activities[0].waiting.sum).toBeCloseTo((0 + 30 + 60 + 90) * 60)
    expect(r.cost.mean).toBeCloseTo(60)
    expect(r.resources[0].utilisation).toBeCloseTo(1)
  })

  it('splits exclusive gateways by probability', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:exclusiveGateway id="x"/><bpmn:task id="a"/><bpmn:task id="b"/>
      <bpmn:endEvent id="e1"/><bpmn:endEvent id="e2"/>
      ${seq('f1', 's', 'x')}${seq('fa', 'x', 'a')}${seq('fb', 'x', 'b')}${seq('f2', 'a', 'e1')}${seq('f3', 'b', 'e2')}`)
    const r = simulate(g, scenario({ cases: 2000, arrival: fixed(60), flows: { fa: 0.8, fb: 0.2 } }))
    const a = r.activities.find((x) => x.id === 'a')!.count
    expect(a / 2000).toBeGreaterThan(0.76)
    expect(a / 2000).toBeLessThan(0.84)
  })

  it('synchronises parallel branches', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:parallelGateway id="p1"/><bpmn:task id="a"/><bpmn:task id="b"/>
      <bpmn:parallelGateway id="p2"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'p1')}${seq('f2', 'p1', 'a')}${seq('f3', 'p1', 'b')}${seq('f4', 'a', 'p2')}${seq('f5', 'b', 'p2')}${seq('f6', 'p2', 'e')}`)
    const r = simulate(g, scenario({ elements: { a: { duration: fixed(3600) }, b: { duration: fixed(7200) } } }))
    expect(r.casesCompleted).toBe(10)
    expect(r.cycle.mean).toBeCloseTo(7200)
  })

  it('waits at inclusive joins only for branches that were taken', () => {
    const body = `<bpmn:startEvent id="s"/><bpmn:inclusiveGateway id="o1"/><bpmn:task id="a"/><bpmn:task id="b"/>
      <bpmn:inclusiveGateway id="o2"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'o1')}${seq('fa', 'o1', 'a')}${seq('fb', 'o1', 'b')}${seq('f4', 'a', 'o2')}${seq('f5', 'b', 'o2')}${seq('f6', 'o2', 'e')}`
    const g = graphOf(body)
    const elements = { a: { duration: fixed(3600) }, b: { duration: fixed(7200) } }
    const both = simulate(g, scenario({ elements, flows: { fa: 1, fb: 1 } }))
    expect(both.cycle.mean).toBeCloseTo(7200)
    const onlyA = simulate(g, scenario({ elements, flows: { fa: 1, fb: 0 } }))
    expect(onlyA.cycle.mean).toBeCloseTo(3600)
    expect(onlyA.casesCompleted).toBe(10)
  })

  it('interrupts an activity with a timer boundary event', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:task id="a"/><bpmn:endEvent id="e"/>
      <bpmn:boundaryEvent id="t" attachedToRef="a"><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
      <bpmn:task id="esc"/><bpmn:endEvent id="e2"/>
      ${seq('f1', 's', 'a')}${seq('f2', 'a', 'e')}${seq('f3', 't', 'esc')}${seq('f4', 'esc', 'e2')}`)
    const r = simulate(g, scenario({ elements: { a: { duration: fixed(7200) }, esc: { duration: fixed(600) } } }))
    expect(r.cycle.mean).toBeCloseTo(3600 + 600)
    expect(r.activities.find((x) => x.id === 'esc')!.count).toBe(10)
  })

  it('runs embedded subprocesses', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/>
      <bpmn:subProcess id="sp"><bpmn:startEvent id="ss"/><bpmn:task id="a"/><bpmn:endEvent id="se"/>
        ${seq('g1', 'ss', 'a')}${seq('g2', 'a', 'se')}</bpmn:subProcess>
      <bpmn:task id="b"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'sp')}${seq('f2', 'sp', 'b')}${seq('f3', 'b', 'e')}`)
    const r = simulate(g, scenario({ elements: { a: { duration: fixed(3600) }, b: { duration: fixed(3600) } } }))
    expect(r.casesCompleted).toBe(10)
    expect(r.cycle.mean).toBeCloseTo(7200)
  })

  it('respects working hours', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:task id="a"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'a')}${seq('f2', 'a', 'e')}`)
    const r = simulate(
      g,
      scenario({
        cases: 1,
        startDate: '2026-11-09T16:00:00.000Z',
        resources: [{ id: 'r', name: 'Clerk', count: 1, costPerHour: 0, timetableId: 'office' }],
        elements: { a: { duration: fixed(7200), resourceId: 'r' } },
      }),
    )
    // Monday 16:00 + 1h work, resumes Tuesday 09:00 for 1h -> Tuesday 10:00
    expect(r.cycle.mean).toBeCloseTo(18 * 3600)
  })

  it('ends the case at a terminate end event', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:parallelGateway id="p"/><bpmn:task id="a"/><bpmn:task id="b"/>
      <bpmn:endEvent id="t"><bpmn:terminateEventDefinition/></bpmn:endEvent><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'p')}${seq('f2', 'p', 'a')}${seq('f3', 'p', 'b')}${seq('f4', 'a', 't')}${seq('f5', 'b', 'e')}`)
    const r = simulate(g, scenario({ elements: { a: { duration: fixed(600) }, b: { duration: fixed(7200) } } }))
    expect(r.cycle.mean).toBeCloseTo(600)
  })

  it('waits at intermediate timer events and is deterministic per seed', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:intermediateCatchEvent id="w"><bpmn:timerEventDefinition><bpmn:timeDuration>PT2H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent><bpmn:task id="a"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'w')}${seq('f2', 'w', 'a')}${seq('f3', 'a', 'e')}`)
    const s = scenario({ arrival: { type: 'exponential', mean: 600, unit: 'minutes' }, elements: { a: { duration: { type: 'exponential', mean: 600, unit: 'minutes' } } } })
    const r1 = simulate(g, s)
    const r2 = simulate(g, s)
    expect(r1.cycle.mean).toBe(r2.cycle.mean)
    expect(r1.cycle.min).toBeGreaterThanOrEqual(7200)
  })
  it('stops arrivals after the horizon, lets cases balk and earns revenue', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:task id="a" name="A"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'a')}${seq('f2', 'a', 'e')}`)
    const r = simulate(
      g,
      scenario({
        cases: 1,
        horizon: 3600,
        arrival: fixed(60),
        resources: [{ id: 'r', name: 'Barista', count: 1, costPerHour: 60, timetableId: 'always' }],
        elements: { a: { duration: fixed(600), resourceId: 'r', maxQueue: 2, revenue: 5 } },
      }),
    )
    expect(r.casesStarted).toBe(60)
    expect(r.casesBalked).toBeGreaterThan(40)
    expect(r.casesCompleted + r.casesBalked).toBe(60)
    expect(r.activities[0].balked).toBe(r.casesBalked)
    expect(r.revenue.sum).toBe(r.casesCompleted * 5)
    expect(r.resources[0].paidCost).toBeGreaterThan(r.resources[0].cost - 1e-6)
  })

  it('groups cases by path', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:exclusiveGateway id="x"/><bpmn:task id="a" name="Basic"/><bpmn:task id="b" name="Special"/>
      <bpmn:endEvent id="e1"/><bpmn:endEvent id="e2"/>
      ${seq('f1', 's', 'x')}${seq('fa', 'x', 'a')}${seq('fb', 'x', 'b')}${seq('f2', 'a', 'e1')}${seq('f3', 'b', 'e2')}`)
    const r = simulate(g, scenario({ cases: 1000, arrival: fixed(60), flows: { fa: 0.7, fb: 0.3 } }))
    expect(r.paths.map((p) => p.label).sort()).toEqual(['Basic', 'Special'])
    expect(r.paths.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1)
  })
})
