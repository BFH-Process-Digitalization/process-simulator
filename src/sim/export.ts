import type { SimResult } from './types'

function iso(start: string, t: number): string {
  return new Date(new Date(start).getTime() + t * 1000).toISOString()
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function logCsv(r: SimResult): string {
  const rows = [['case_id', 'activity', 'resource', 'start_time', 'end_time']]
  const events = [...r.log].sort((a, b) => a.caseId - b.caseId || a.start - b.start)
  for (const e of events) rows.push([`case_${e.caseId + 1}`, e.activity, e.resource, iso(r.startDate, e.start), iso(r.startDate, e.end)])
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

function xmlEsc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function logXes(r: SimResult): string {
  const byCase = new Map<number, typeof r.log>()
  for (const e of r.log) {
    if (!byCase.has(e.caseId)) byCase.set(e.caseId, [])
    byCase.get(e.caseId)!.push(e)
  }
  let x = `<?xml version="1.0" encoding="UTF-8"?>
<log xes.version="1849-2016" xmlns="http://www.xes-standard.org/">
  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>
  <extension name="Time" prefix="time" uri="http://www.xes-standard.org/time.xesext"/>
  <extension name="Lifecycle" prefix="lifecycle" uri="http://www.xes-standard.org/lifecycle.xesext"/>
  <extension name="Organizational" prefix="org" uri="http://www.xes-standard.org/org.xesext"/>
  <string key="concept:name" value="${xmlEsc(r.scenarioName)}"/>
`
  for (const [id, evs] of [...byCase.entries()].sort((a, b) => a[0] - b[0])) {
    x += `  <trace>\n    <string key="concept:name" value="case_${id + 1}"/>\n`
    const items = evs.flatMap((e) => [
      { t: e.start, e, life: 'start' },
      { t: e.end, e, life: 'complete' },
    ])
    items.sort((a, b) => a.t - b.t)
    for (const it of items) {
      x += `    <event><string key="concept:name" value="${xmlEsc(it.e.activity)}"/><string key="lifecycle:transition" value="${it.life}"/>`
      if (it.e.resource) x += `<string key="org:resource" value="${xmlEsc(it.e.resource)}"/>`
      x += `<date key="time:timestamp" value="${iso(r.startDate, it.t)}"/></event>\n`
    }
    x += '  </trace>\n'
  }
  return x + '</log>\n'
}

export function resultsCsv(results: SimResult[]): string {
  const rows: (string | number)[][] = [['scenario', 'metric', 'element', 'value']]
  for (const r of results) {
    const add = (metric: string, element: string, value: number) => rows.push([r.scenarioName, metric, element, Math.round(value * 100) / 100])
    add('cases_completed', '', r.casesCompleted)
    add('cycle_time_mean_s', '', r.cycle.mean)
    add('cycle_time_median_s', '', r.cycle.median)
    add('cycle_time_p90_s', '', r.cycle.p90)
    add('waiting_time_mean_s', '', r.waiting.mean)
    add('cost_per_case_mean', '', r.cost.mean)
    add('throughput_per_day', '', r.throughputPerDay)
    for (const a of r.activities) {
      add('activity_runs', a.name, a.count)
      add('activity_waiting_mean_s', a.name, a.waiting.mean)
      add('activity_processing_mean_s', a.name, a.processing.mean)
      add('activity_cost', a.name, a.cost)
    }
    for (const res of r.resources) add('resource_utilisation', res.name, res.utilisation)
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export function download(name: string, content: BlobPart, type = 'text/plain') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
