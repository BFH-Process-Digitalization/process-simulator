import { readFileSync } from 'node:fs'
import BpmnModdle from 'bpmn-moddle'
import { describe, expect, it } from 'vitest'
import { embedProject, readProject } from '../../../src/sim/projectFile'
import { scopeCss } from '../../vite.config'
import { descriptor } from '../descriptor'

const sample = readFileSync(new URL('../../../public/samples/coffee-shop.bpmn', import.meta.url), 'utf8')

describe('Camunda Modeler plugin', () => {
  it('reads the scenarios saved by the web app and writes them back readable for it', async () => {
    const moddle = new BpmnModdle({ psim: descriptor })
    const { rootElement, warnings } = await moddle.fromXML(sample)
    expect(warnings).toHaveLength(0)
    const defs = rootElement as unknown as { project?: { body: string } }
    const project = JSON.parse(defs.project!.body)
    expect(project.variants.length).toBe(4)

    project.variants[0].name = 'Renamed <in> the modeler & saved'
    defs.project = moddle.create('psim:Project', { body: JSON.stringify(project) }) as unknown as { body: string }
    const { xml } = await moddle.toXML(rootElement, { format: true })
    expect(readProject(xml)).toEqual(project)
    expect(readProject(embedProject(xml, project))).toEqual(project)
  })

  it('scopes the app styles to the plugin', () => {
    const css = scopeCss(':root { --ink: #111; font-size: 13px; }\nhtml, body { margin: 0; }\nbutton, .tab { padding: 1px; }\n.sim-chip { color: red; }')
    expect(css).toContain('.psim-ui {')
    expect(css).toMatch(/\.psim-on \{\s*--ink: #111;\}/)
    expect(css).not.toContain('html')
    expect(css).toContain('.psim-ui button, .psim-ui .tab {')
    expect(css).toContain('.psim-on .sim-chip {')
  })

  it('scopes rules inside container queries and keeps the rules after them', () => {
    const css = scopeCss('.a { color: red; }\n@container (max-width: 760px) {\n  .b { gap: 1px; }\n}\n.c { margin: 0; }')
    expect(css).toMatch(/@container \(max-width: 760px\) \{\s*\.psim-ui \.b \{/)
    expect(css).toContain('.psim-ui .c {')
  })
})
