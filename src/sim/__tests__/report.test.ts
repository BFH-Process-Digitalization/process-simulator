import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { AUTHOR } from '../../about'
import { simulate } from '../engine'
import { comparisonMetrics, reportHtml, reportSheets, xlsx } from '../report'
import { fixed, graphOf, scenario } from './helpers'

const g = graphOf(`<bpmn:startEvent id="s"/><bpmn:task id="a" name="Serve &amp; pay"/><bpmn:endEvent id="e"/>
  <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="a"/><bpmn:sequenceFlow id="f2" sourceRef="a" targetRef="e"/>`)
const run = (id: string, name: string, count: number) =>
  simulate(
    g,
    scenario({
      id,
      name,
      cases: 6,
      arrival: fixed(600),
      resources: [
        {
          id: 'r',
          name: 'Clerk',
          count,
          costPerHour: 60,
          timetableId: 'always',
        },
      ],
      elements: { a: { duration: fixed(900), resourceId: 'r' } },
    }),
  )

describe('report', () => {
  const results = [run('baseline', 'Baseline', 1), run('v1', 'Two clerks', 2)]

  it('compares scenarios grouped by topic', () => {
    const metrics = comparisonMetrics(results)
    expect([...new Set(metrics.map((m) => m.group))]).toEqual(['Output', 'Time', 'People', 'Money'])
    const people = metrics.find((m) => m.label === 'Clerk: people')!
    expect(results.map((r) => people.get(r))).toEqual([1, 2])
    const waiting = metrics.find((m) => m.label === 'Waiting, average')!
    expect(waiting.get(results[1])!).toBeLessThan(waiting.get(results[0])!)
  })

  it('writes a valid xlsx workbook with one sheet per topic', () => {
    const files = unzipSync(xlsx(reportSheets(results)))
    expect(Object.keys(files)).toContain('[Content_Types].xml')
    const wb = strFromU8(files['xl/workbook.xml'])
    for (const n of ['Comparison', 'People', 'Activities', 'Paths', 'About']) expect(wb).toContain(`name="${n}"`)
    const cmp = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(cmp).toContain('Two clerks')
    expect(strFromU8(files['xl/worksheets/sheet3.xml'])).toContain('Serve &amp; pay')
    const about = strFromU8(files['xl/worksheets/sheet5.xml'])
    expect(about).toContain(AUTHOR)
    expect(about).toContain('Apache License, Version 2.0')
  })

  it('renders a printable report with a page per scenario', () => {
    const html = reportHtml(results, 'Report')
    expect(html).toContain('Scenarios compared')
    expect(html.match(/<section class="scenario">/g)).toHaveLength(2)
    expect(html).toContain('Serve &amp; pay')
    expect(html.split('<body')[1].split(AUTHOR)).toHaveLength(2)
    expect(html).toContain('Apache License, Version 2.0')
  })
})
