import { describe, expect, it } from 'vitest'
import { simulate } from '../engine'
import { confidence, pairedDifference, replicate } from '../replicate'
import type { Distribution } from '../types'
import { valueStream } from '../value'
import { fixed, graphOf, scenario } from './helpers'

const seq = (id: string, s: string, t: string) => `<bpmn:sequenceFlow id="${id}" sourceRef="${s}" targetRef="${t}"/>`
const exp = (mean: number): Distribution => ({ type: 'exponential', mean, unit: 'seconds' })
const one = graphOf(`<bpmn:startEvent id="s"/><bpmn:task id="a"/><bpmn:endEvent id="e"/>${seq('f1', 's', 'a')}${seq('f2', 'a', 'e')}`)

/** Mean waiting time in queue of an M/M/c queue (Erlang C). */
function mmcWait(lambda: number, mu: number, c: number): number {
  const a = lambda / mu
  const rho = a / c
  let sum = 0
  let term = 1
  for (let k = 0; k < c; k++) {
    sum += term
    term *= a / (k + 1)
  }
  const tail = term / (1 - rho)
  return tail / (sum + tail) / (c * mu - lambda)
}

const queue = (arrival: Distribution, service: Distribution, servers: number, cases = 20000) =>
  scenario({
    cases,
    arrival,
    warmup: 50 * 3600,
    resources: [{ id: 'r', name: 'Server', count: servers, costPerHour: 0, timetableId: 'always' }],
    elements: { a: { duration: service, resourceId: 'r' } },
  })

describe('analytical verification', () => {
  it('matches M/M/1 waiting time', () => {
    const r = replicate(one, queue(exp(60), exp(48), 1), {}, 10)
    const ci = confidence(r.reps!.values['wait.a'])
    const exact = mmcWait(1 / 60, 1 / 48, 1)
    expect(Math.abs(ci.mean - exact) / exact).toBeLessThan(0.06)
    expect(confidence(r.reps!.values['util.r']).mean).toBeCloseTo(0.8, 1)
  })

  it('matches M/M/3 waiting time', () => {
    const r = replicate(one, queue(exp(20), exp(48), 3), {}, 10)
    const exact = mmcWait(1 / 20, 1 / 48, 3)
    expect(Math.abs(confidence(r.reps!.values['wait.a']).mean - exact) / exact).toBeLessThan(0.06)
  })

  it("satisfies Little's law", () => {
    const r = simulate(one, queue(exp(60), exp(48), 1))
    const lambda = r.casesCompleted / r.span
    expect(Math.abs(r.wip - lambda * r.cycle.mean) / r.wip).toBeLessThan(0.03)
  })
})

describe('random numbers', () => {
  const two = graphOf(`<bpmn:startEvent id="s"/><bpmn:task id="a"/><bpmn:task id="b"/><bpmn:endEvent id="e"/>
    ${seq('f1', 's', 'a')}${seq('f2', 'a', 'b')}${seq('f3', 'b', 'e')}`)
  const base = (bMean: number, b: Distribution = exp(bMean)) =>
    scenario({ cases: 500, arrival: exp(600), elements: { a: { duration: exp(300) }, b: { duration: b } } })
  const normal: Distribution = { type: 'normal', mean: 300, sd: 60, unit: 'seconds' }

  it('keeps the draws of other sources when one source changes', () => {
    const r1 = simulate(two, base(300))
    const r2 = simulate(two, base(900, normal))
    expect(r2.activities.find((x) => x.id === 'a')!.processing.sum).toBe(r1.activities.find((x) => x.id === 'a')!.processing.sum)
    expect(r2.casesStarted).toBe(r1.casesStarted)
  })

  it('shifts all later draws with a single stream', () => {
    const r1 = simulate(two, base(300), { rng: 'single' })
    const r2 = simulate(two, base(900, normal), { rng: 'single' })
    expect(r2.activities.find((x) => x.id === 'a')!.processing.sum).not.toBe(r1.activities.find((x) => x.id === 'a')!.processing.sum)
  })

  it('pairs replications across scenarios', () => {
    const a = replicate(two, base(300), {}, 8)
    const b = replicate(two, base(330), {}, 8)
    const paired = pairedDifference(a.reps!.values.cycle, b.reps!.values.cycle)
    expect(paired.mean).toBeGreaterThan(0)
    expect(paired.half).toBeLessThan(confidence(b.reps!.values.cycle).half)
  })
})

describe('value stream', () => {
  it('counts parallel work once', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:parallelGateway id="p1"/><bpmn:task id="a"/><bpmn:task id="b"/>
      <bpmn:parallelGateway id="p2"/><bpmn:endEvent id="e"/>
      ${seq('f1', 's', 'p1')}${seq('fa', 'p1', 'a')}${seq('fb', 'p1', 'b')}${seq('fa2', 'a', 'p2')}${seq('fb2', 'b', 'p2')}${seq('f2', 'p2', 'e')}`)
    const r = simulate(g, scenario({ elements: { a: { duration: fixed(600), value: 'va' }, b: { duration: fixed(1200), value: 'nva' } } }))
    const vs = valueStream(r)
    expect(vs.leadTime).toBeCloseTo(1200)
    expect(r.flow.va).toBeCloseTo(600)
    expect(r.flow.nva).toBeCloseTo(600)
    expect(r.flow.wait).toBeCloseTo(0)
    expect(vs.efficiency).toBeCloseTo(0.5)
    expect(vs.linearLeadTime).toBeCloseTo(1800)
  })

  it('weights alternative paths and adds waiting', () => {
    const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:exclusiveGateway id="x"/><bpmn:task id="a"/><bpmn:task id="b"/>
      <bpmn:endEvent id="e1"/><bpmn:endEvent id="e2"/>
      ${seq('f1', 's', 'x')}${seq('fa', 'x', 'a')}${seq('fb', 'x', 'b')}${seq('f2', 'a', 'e1')}${seq('f3', 'b', 'e2')}`)
    const r = simulate(
      g,
      scenario({ cases: 4000, arrival: fixed(3600), flows: { fa: 0.25, fb: 0.75 }, elements: { a: { duration: fixed(400), value: 'va' }, b: { duration: fixed(800), value: 'va' } } }),
    )
    const share = r.activities.find((x) => x.id === 'a')!.count / r.casesCompleted
    expect(r.flow.va).toBeCloseTo(share * 400 + (1 - share) * 800, 3)
    expect(r.flow.va + r.flow.wait).toBeCloseTo(r.cycle.mean, 3)
  })

  it('counts repeated runs of a step as rework', () => {
    const r = simulate(one, scenario({ cases: 2000, arrival: fixed(36000), elements: { a: { duration: fixed(600), value: 'va', repeatProbability: 0.5 } } }))
    expect(r.flow.va).toBeCloseTo(600)
    expect(r.flow.rework / 600).toBeGreaterThan(0.9)
    expect(r.flow.rework / 600).toBeLessThan(1.1)
    expect(r.flow.va + r.flow.rework + r.flow.wait).toBeCloseTo(r.cycle.mean, 3)
  })
})
