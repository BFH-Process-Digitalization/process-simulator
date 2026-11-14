import { describe, expect, it } from 'vitest'
import { buildGraph } from '../graph'
import { changeCount, defaultScenario, resolve, setValue, type Project } from '../params'
import { embedProject, readProject } from '../projectFile'
import { bpmn, scenario } from './helpers'

const xml = bpmn(`<bpmn:laneSet><bpmn:lane id="l1" name="Clerk"><bpmn:flowNodeRef>a</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
  <bpmn:startEvent id="s"/><bpmn:task id="a" name="Check application"/><bpmn:endEvent id="e"/>
  <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="a"/><bpmn:sequenceFlow id="f2" sourceRef="a" targetRef="e"/>`)

describe('scenarios', () => {
  it('derives resources from lanes', () => {
    const s = defaultScenario(buildGraph(xml).graph)
    expect(s.resources.map((r) => r.name)).toEqual(['Clerk'])
    expect(s.elements.a.resourceId).toBe(s.resources[0].id)
    expect(s.elements.a.duration?.mean).toBe(900)
  })

  it('stores only overrides in variants', () => {
    let p: Project = { baseline: scenario({ cases: 100 }), variants: [{ id: 'v', name: 'More', overrides: {} }] }
    p = setValue(p, 'v', 'cases', 300)
    expect(resolve(p, 'v').cases).toBe(300)
    expect(changeCount(p.variants[0])).toBe(1)
    p = setValue(p, 'v', 'cases', 100)
    expect(changeCount(p.variants[0])).toBe(0)
    p = setValue(p, 'baseline', 'cases', 50)
    expect(resolve(p, 'v').cases).toBe(50)
  })

  it('round-trips the project through the BPMN file', () => {
    const base = defaultScenario(buildGraph(xml).graph)
    const p: Project = { baseline: base, variants: [{ id: 'v', name: 'Two clerks', overrides: { cases: 5 } }] }
    const out = embedProject(xml, p)
    expect(readProject(out)).toEqual(p)
    // embedding twice does not duplicate
    expect(embedProject(out, p).match(/<psim:project>/g)!.length).toBe(1)
    expect(buildGraph(out).graph.nodes.a.name).toBe('Check application')
  })
})
