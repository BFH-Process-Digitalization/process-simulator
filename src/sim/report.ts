import { strToU8, zipSync } from 'fflate'
import { APP_NAME, AUTHOR, COPYRIGHT, LICENCE, LICENCE_URL, NOTICES_URL, THIRD_PARTY } from '../about'
import { pairedDifference } from './replicate'
import { VALUE_LABEL, valueStream } from './value'
import { formatDuration } from './time'
import type { SimResult } from './types'

export type Cell = string | number | null
export interface Sheet {
  name: string
  rows: Cell[][]
}

type Kind = 'count' | 'time' | 'share' | 'money' | 'rate'
export interface Metric {
  group: string
  label: string
  kind: Kind
  get: (r: SimResult) => number | undefined
  better?: 'lower' | 'higher'
  /** name of the per-run value, for confidence intervals over replications */
  key?: (r: SimResult) => string | undefined
}

/** Whether the paired 95 % interval of r minus base excludes zero; undefined without replications. */
export function significance(m: Metric, r: SimResult, base: SimResult): boolean | undefined {
  const kb = m.key?.(base)
  const k = m.key?.(r)
  const a = kb ? base.reps?.values[kb] : undefined
  const b = k ? r.reps?.values[k] : undefined
  if (!a || !b || a.length < 2 || a.length !== b.length) return undefined
  return pairedDifference(a, b).significant
}

/** How the scenarios were run, for the notes under comparisons. */
export function runsNote(results: SimResult[]): string {
  const n = Math.min(...results.map((r) => r.reps?.n ?? 1))
  return n > 1
    ? `Each scenario was simulated ${n} times. Run i of every scenario uses the same random numbers (common random numbers), and values are averages over the runs. "n.s." marks a change whose 95 % confidence interval, from the paired runs, includes zero: it may be chance.`
    : 'Each scenario is one simulated run. Simulate each scenario several times to tell real changes from chance.'
}

const r2 = (v: number) => (isFinite(v) ? Math.round(v * 100) / 100 : null)
const minutes = (s: number) => r2(s / 60)

export function moneyOf(r: SimResult) {
  const hours = r.span / 3600 || 1
  const revenue = r.revenue.sum
  const staff = r.resources.reduce((a, x) => a + x.paidCost, 0)
  return {
    revenue,
    staff,
    revenuePerHour: revenue / hours,
    staffPerHour: staff / hours,
    margin: revenue - staff,
    perCase: r.cost.count ? r.cost.mean : 0,
  }
}

/** The activity where cases wait longest on average, with the role doing it. */
export function bottleneck(r: SimResult) {
  const top = [...r.activities].sort((a, b) => b.waiting.mean - a.waiting.mean)[0]
  if (!top || top.waiting.mean <= 0) return undefined
  return {
    activity: top,
    resource: r.resources.find((x) => x.id === top.resourceId),
  }
}

export function throughputLabel(r: SimResult) {
  return r.span < 2 * 86400 ? `${r.throughputPerHour.toFixed(1)} / h` : `${r.throughputPerDay.toFixed(1)} / day`
}

export function formatMoney(v: number, currency: string) {
  return `${currency} ${v.toLocaleString('de-CH', { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 })}`
}

export function formatMetric(m: Metric, v: number | undefined, currency: string): string {
  if (v === undefined || !isFinite(v)) return '–'
  switch (m.kind) {
    case 'count':
      return String(Math.round(v))
    case 'time':
      return formatDuration(v)
    case 'share':
      return `${Math.round(v * 100)} %`
    case 'money':
      return formatMoney(v, currency)
    case 'rate':
      return `${v.toFixed(1)} / h`
  }
}

function excelValue(m: Metric, v: number | undefined): Cell {
  if (v === undefined || !isFinite(v)) return null
  if (m.kind === 'time') return minutes(v)
  if (m.kind === 'share') return r2(v * 100)
  return r2(v)
}

function excelLabel(m: Metric, currency: string) {
  const unit = {
    count: '',
    time: ' (min)',
    share: ' (%)',
    money: ` (${currency})`,
    rate: ' (per hour)',
  }[m.kind]
  return m.label + unit
}

/** Metrics shown when scenarios are compared, grouped by topic. */
export function comparisonMetrics(results: SimResult[]): Metric[] {
  const roles = [...new Set(results.flatMap((r) => r.resources.map((x) => x.name)))]
  const role = (r: SimResult, name: string) => r.resources.find((x) => x.name === name)
  const metrics: Metric[] = [
    {
      group: 'Output',
      label: 'Cases served',
      kind: 'count',
      get: (r) => r.casesCompleted,
      key: () => 'casesCompleted',
      better: 'higher',
    },
    {
      group: 'Output',
      label: 'Left without service',
      kind: 'count',
      get: (r) => r.casesBalked,
      key: () => 'casesBalked',
      better: 'lower',
    },
    {
      group: 'Output',
      label: 'Throughput',
      kind: 'rate',
      get: (r) => r.throughputPerHour,
      key: () => 'throughputPerHour',
      better: 'higher',
    },
    {
      group: 'Time',
      label: 'Cycle time, average',
      kind: 'time',
      get: (r) => r.cycle.mean,
      key: () => 'cycle',
      better: 'lower',
    },
    {
      group: 'Time',
      label: 'Cycle time, 90 % within',
      kind: 'time',
      get: (r) => r.cycle.p90,
      better: 'lower',
    },
    {
      group: 'Time',
      label: 'Waiting, average',
      kind: 'time',
      get: (r) => r.waiting.mean,
      key: () => 'waiting',
      better: 'lower',
    },
    {
      group: 'Time',
      label: 'Working, average',
      kind: 'time',
      get: (r) => r.processing.mean,
      key: () => 'processing',
    },
  ]
  if (results.some((r) => valueStream(r).classified)) {
    metrics.push({ group: 'Time', label: 'Process cycle efficiency', kind: 'share', get: (r) => valueStream(r).efficiency, better: 'higher', key: () => 'pce' })
  }
  for (const name of roles) {
    metrics.push({
      group: 'People',
      label: `${name}: people`,
      kind: 'count',
      get: (r) => role(r, name)?.count,
    })
    metrics.push({
      group: 'People',
      label: `${name}: busy`,
      kind: 'share',
      get: (r) => role(r, name)?.utilisation,
      key: (r) => {
        const x = role(r, name)
        return x && 'util.' + x.id
      },
    })
  }
  const anyRevenue = results.some((r) => r.revenue.sum > 0)
  const anyStaff = results.some((r) => moneyOf(r).staff > 0)
  if (anyStaff || anyRevenue || results.some((r) => r.cost.sum > 0)) {
    metrics.push({
      group: 'Money',
      label: 'Cost per case',
      kind: 'money',
      get: (r) => moneyOf(r).perCase,
      better: 'lower',
    })
  }
  if (anyStaff)
    metrics.push({
      group: 'Money',
      label: 'Staff cost per hour',
      kind: 'money',
      get: (r) => moneyOf(r).staffPerHour,
      better: 'lower',
    })
  if (anyRevenue) {
    metrics.push({
      group: 'Money',
      label: 'Revenue per hour',
      kind: 'money',
      get: (r) => moneyOf(r).revenuePerHour,
      better: 'higher',
    })
    metrics.push({
      group: 'Money',
      label: 'Revenue minus staff cost',
      kind: 'money',
      get: (r) => moneyOf(r).margin,
      better: 'higher',
    })
  }
  return metrics
}

function aboutRows(): Cell[][] {
  return [
    ['About', ''],
    ['Created with', APP_NAME],
    ['Copyright', COPYRIGHT],
    ['Licence', LICENCE],
    ['Full licence', LICENCE_URL],
    ['Third-party software', THIRD_PARTY],
    ['Third-party notices', NOTICES_URL],
  ]
}

export function reportSheets(results: SimResult[]): Sheet[] {
  const currency = results[0]?.currency ?? ''
  const comparison: Cell[][] = [['Group', 'Metric', ...results.map((r) => r.scenarioName)]]
  for (const m of comparisonMetrics(results)) comparison.push([m.group, excelLabel(m, currency), ...results.map((r) => excelValue(m, m.get(r)))])

  const people: Cell[][] = [
    ['Scenario', 'Role', 'People', 'Busy (%)', 'Busy hours', 'Paid hours', `Staff cost paid (${currency})`, `Cost of busy time (${currency})`],
  ]
  const activities: Cell[][] = [
    [
      'Scenario',
      'Activity',
      'Role',
      'Value',
      'Runs',
      'Waiting, average (min)',
      'Waiting, 90 % within (min)',
      'Working, average (min)',
      'Left without service',
      `Cost (${currency})`,
      `Revenue (${currency})`,
    ],
  ]
  const paths: Cell[][] = [['Scenario', 'Path', 'Cases', 'Share (%)', 'Cycle time, average (min)', 'Waiting, average (min)', `Revenue (${currency})`]]
  for (const r of results) {
    for (const x of r.resources) {
      people.push([
        r.scenarioName,
        x.name,
        x.count,
        r2(x.utilisation * 100),
        r2(x.busySeconds / 3600),
        r2(x.availableSeconds / 3600),
        r2(x.paidCost),
        r2(x.cost),
      ])
    }
    for (const a of [...r.activities].sort((p, q) => q.waiting.mean - p.waiting.mean)) {
      const role = r.resources.find((x) => x.id === a.resourceId)?.name ?? ''
      activities.push([
        r.scenarioName,
        a.name,
        role,
        a.value ? VALUE_LABEL[a.value] : '',
        a.count,
        minutes(a.waiting.mean),
        minutes(a.waiting.p90),
        minutes(a.processing.mean),
        a.balked,
        r2(a.cost),
        r2(a.revenue),
      ])
    }
    for (const p of r.paths) paths.push([r.scenarioName, p.label, p.count, r2(p.share * 100), minutes(p.cycle.mean), minutes(p.waiting.mean), r2(p.revenue)])
  }
  return [
    { name: 'Comparison', rows: comparison },
    { name: 'People', rows: people },
    { name: 'Activities', rows: activities },
    { name: 'Paths', rows: paths },
    { name: 'About', rows: aboutRows() },
  ]
}

const printable = (s: string) => [...s].filter((c) => c >= ' ' || c === '\t' || c === '\n' || c === '\r').join('')
const xmlEsc = (s: string) => printable(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colName(i: number) {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function sheetXml(rows: Cell[][]) {
  const cols = rows[0]?.length ?? 0
  const widths = Array.from({ length: cols }, (_, c) => Math.min(50, Math.max(8, ...rows.map((r) => String(r[c] ?? '').length + 2))))
  const data = rows
    .map((row, ri) => {
      const cells = row
        .map((v, ci) => {
          const ref = colName(ci) + (ri + 1)
          const s = ri === 0 ? ' s="1"' : ''
          if (v === null || v === '') return ''
          if (typeof v === 'number') return isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : ''
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`
        })
        .join('')
      return `<row r="${ri + 1}">${cells}</row>`
    })
    .join('')
  const colXml = cols ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
  return `${XML}<worksheet xmlns="${MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colXml}<sheetData>${data}</sheetData></worksheet>`
}

const STYLES = `${XML}<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

/** Writes a minimal Office Open XML workbook (.xlsx). */
export function xlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>()
  const names = sheets.map((s, i) => {
    let n = s.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Sheet${i + 1}`
    while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i + 1}`
    used.add(n.toLowerCase())
    return n
  })
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
  }
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows))))
  return zipSync(files)
}

const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Change against the baseline: counts and values around zero as absolute differences, the rest in percent. */
export function change(
  m: Metric,
  v: number | undefined,
  base: number | undefined,
  currency: string,
  significant?: boolean,
): { text: string; cls: '' | 'good' | 'bad' } | null {
  if (v === undefined || base === undefined || !isFinite(v) || !isFinite(base)) return null
  const diff = v - base
  const absolute = m.kind === 'count' || base <= 0 || v < 0
  const rel = absolute ? 0 : diff / base
  if (Math.abs(diff) < 1e-9 || (!absolute && Math.abs(rel) < 0.005)) return null
  const cls = !m.better ? '' : (m.better === 'lower') === diff < 0 ? 'good' : 'bad'
  const text = (diff > 0 ? '+' : '−') + (absolute ? formatMetric(m, Math.abs(diff), currency) : `${Math.abs(Math.round(rel * 100))} %`)
  return significant === false ? { text: text + ' n.s.', cls: '' } : { text, cls }
}

function deltaHtml(m: Metric, v: number | undefined, base: number | undefined, currency: string, significant?: boolean) {
  const c = change(m, v, base, currency, significant)
  return c ? `<small class="${c.cls}">${h(c.text)}</small>` : ''
}

const REPORT_CSS = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: Inter, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111827; font-size: 10.5pt; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 14pt; margin: 0 0 10px; }
h3 { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin: 18px 0 6px; }
.meta { color: #6b7280; margin-bottom: 18px; }
section.scenario { break-before: page; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th { text-align: left; font-weight: 600; color: #6b7280; font-size: 9pt; padding: 5px 6px; border-bottom: 1px solid #d1d5db; }
td { padding: 5px 6px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
td.num, th.num { text-align: right; }
td.num { white-space: nowrap; }
td.num small { display: block; line-height: 1.2; }
tr.group td { font-weight: 600; background: #f6f7f9; color: #374151; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; }
tr { break-inside: avoid; }
small { color: #6b7280; font-size: 8pt; }
small.good { color: #15803d; } small.bad { color: #b91c1c; }
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
.card .l { font-size: 8.5pt; color: #6b7280; } .card .v { font-size: 14pt; font-weight: 600; margin: 2px 0; } .card .s { font-size: 8.5pt; color: #6b7280; }
.card.hot { border-color: #fecaca; background: #fef2f2; }
.warn { background: #fffbeb; border: 1px solid #fde68a; color: #78350f; border-radius: 6px; padding: 6px 8px; font-size: 9pt; margin-bottom: 10px; }
.foot { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 8pt; line-height: 1.5; break-inside: avoid; }
`

/** A printable HTML report: comparison of all scenarios, then one page per scenario. */
export function reportHtml(results: SimResult[], title: string): string {
  const currency = results[0]?.currency ?? ''
  const base = results.find((r) => r.scenarioId === 'baseline') ?? results[0]
  const metrics = comparisonMetrics(results)
  const groups = [...new Set(metrics.map((m) => m.group))]
  const date = new Date().toLocaleString('de-CH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const comparison =
    results.length > 1
      ? `<h3>Scenarios compared</h3><table><thead><tr><th>Metric</th>${results.map((r) => `<th class="num">${h(r.scenarioName)}</th>`).join('')}</tr></thead><tbody>${groups
          .map(
            (g) =>
              `<tr class="group"><td colspan="${results.length + 1}">${h(g)}</td></tr>` +
              metrics
                .filter((m) => m.group === g)
                .map(
                  (m) =>
                    `<tr><td>${h(m.label)}</td>${results
                      .map(
                        (r) =>
                          `<td class="num">${h(formatMetric(m, m.get(r), currency))}${r === base ? '' : deltaHtml(m, m.get(r), m.get(base), currency, significance(m, r, base))}</td>`,
                      )
                      .join('')}</tr>`,
                )
                .join(''),
          )
          .join(
            '',
          )}</tbody></table><p class="meta">Changes are relative to ${h(base.scenarioName)}. ${h(runsNote(results))}</p>`
      : ''

  const scenario = (r: SimResult) => {
    const mo = moneyOf(r)
    const bn = bottleneck(r)
    const card = (l: string, v: string, s: string, hot = false) =>
      `<div class="card${hot ? ' hot' : ''}"><div class="l">${h(l)}</div><div class="v">${h(v)}</div><div class="s">${h(s)}</div></div>`
    const acts = [...r.activities].sort((a, b) => b.waiting.mean - a.waiting.mean)
    return `<section class="scenario">
<h2>${h(r.scenarioName)}</h2>
${r.warnings.map((w) => `<div class="warn">${h(w)}</div>`).join('')}
<div class="cards">
${card('Cases served', String(r.casesCompleted), `${throughputLabel(r)} · ${r.casesStarted} arrived` + (r.casesBalked ? ` · ${r.casesBalked} left` : ''))}
${card('Cycle time, average', formatDuration(r.cycle.mean), `90 % within ${formatDuration(r.cycle.p90)}`)}
${card('Waiting, average', formatDuration(r.waiting.mean), `working ${formatDuration(r.processing.mean)}`)}
${bn ? card('Biggest bottleneck', bn.activity.name, `waits ${formatDuration(bn.activity.waiting.mean)}` + (bn.resource ? ` · ${bn.resource.name} ${Math.round(bn.resource.utilisation * 100)} % busy` : ''), true) : card('Biggest bottleneck', 'None', 'no case had to wait')}
</div>
<h3>People</h3>
<table><thead><tr><th>Role</th><th class="num">People</th><th class="num">Busy</th><th class="num">Busy hours</th><th class="num">Staff cost paid</th></tr></thead><tbody>
${r.resources.map((x) => `<tr><td>${h(x.name)}</td><td class="num">${x.count}</td><td class="num">${Math.round(x.utilisation * 100)} %</td><td class="num">${(x.busySeconds / 3600).toFixed(1)}</td><td class="num">${h(formatMoney(x.paidCost, currency))}</td></tr>`).join('')}
</tbody></table>
<h3>Where cases wait</h3>
<table><thead><tr><th>Activity</th><th>Role</th><th class="num">Waiting</th><th class="num">90 % within</th><th class="num">Working</th><th class="num">Runs</th></tr></thead><tbody>
${acts
  .map(
    (a) =>
      `<tr><td>${h(a.name)}</td><td>${h(r.resources.find((x) => x.id === a.resourceId)?.name ?? '')}</td><td class="num">${formatDuration(a.waiting.mean)}</td><td class="num">${formatDuration(a.waiting.p90)}</td><td class="num">${formatDuration(a.processing.mean)}</td><td class="num">${a.count}${a.balked ? ` <small class="bad">${a.balked} left</small>` : ''}</td></tr>`,
  )
  .join('')}
</tbody></table>
${
  r.paths.length > 1
    ? `<h3>By path</h3><table><thead><tr><th>Path</th><th class="num">Share</th><th class="num">Cycle time</th><th class="num">Waiting</th></tr></thead><tbody>${r.paths
        .map(
          (p) =>
            `<tr><td>${h(p.label)}</td><td class="num">${Math.round(p.share * 100)} %</td><td class="num">${formatDuration(p.cycle.mean)}</td><td class="num">${formatDuration(p.waiting.mean)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : ''
}
${
  mo.revenue > 0 || mo.staff > 0
    ? `<h3>Money</h3><table><tbody>
<tr><td>Revenue</td><td class="num">${h(formatMoney(mo.revenue, currency))}</td><td class="num">${h(formatMoney(mo.revenuePerHour, currency))} / h</td></tr>
<tr><td>Staff cost (paid time)</td><td class="num">${h(formatMoney(mo.staff, currency))}</td><td class="num">${h(formatMoney(mo.staffPerHour, currency))} / h</td></tr>
<tr><td><b>Revenue minus staff cost</b></td><td class="num"><b>${h(formatMoney(mo.margin, currency))}</b></td><td></td></tr>
<tr><td>Cost per case (work time and fixed costs)</td><td class="num">${h(formatMoney(mo.perCase, currency))}</td><td></td></tr>
</tbody></table>`
    : ''
}
</section>`
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="author" content="${h(AUTHOR)}"><meta name="copyright" content="${h(COPYRIGHT)}"><title>${h(title)}</title><style>${REPORT_CSS}</style></head><body>
<h1>${h(title)}</h1>
<div class="meta">Created ${h(date)} · ${results.length} scenario${results.length === 1 ? '' : 's'} · ${h(APP_NAME)}</div>
${comparison}
${results.map(scenario).join('\n')}
<div class="foot">Created with ${h(APP_NAME)}. ${h(COPYRIGHT)} ${h(LICENCE)}<br>${h(THIRD_PARTY)} ${h(NOTICES_URL)}</div>
</body></html>`
}

/** Opens the browser's print dialog for an HTML document, where it can be saved as PDF. */
export function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = html
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.appendChild(frame)
}
