import { metricInterval } from '../sim/replicate'
import { download, logCsv, logXes, resultsCsv } from '../sim/export'
import {
  bottleneck,
  change,
  comparisonMetrics,
  runsNote,
  significance,
  formatMetric,
  formatMoney,
  moneyOf,
  printHtml,
  reportHtml,
  reportSheets,
  throughputLabel,
  xlsx,
  type Metric,
} from '../sim/report'
import { formatDuration } from '../sim/time'
import type { SimResult } from '../sim/types'

interface Props {
  results: SimResult[]
  current?: SimResult
  baselineId: string
  onSelectActivity: (id: string) => void
}

function delta(v: number | undefined, base: number | undefined, better?: Metric['better']) {
  if (v === undefined || base === undefined || !isFinite(v) || !isFinite(base) || base === 0) return null
  const d = (v - base) / Math.abs(base)
  if (Math.abs(d) < 0.005) return <span className="delta">±0 %</span>
  const cls = !better ? '' : (better === 'lower') === d < 0 ? 'good' : 'bad'
  return (
    <span className={'delta ' + cls}>
      {d > 0 ? '+' : '−'}
      {Math.abs(Math.round(d * 100))} %
    </span>
  )
}

const CmpDelta = ({ c }: { c: ReturnType<typeof change> }) => (c ? <span className={'delta ' + c.cls}>{c.text}</span> : null)

const MARGIN: Metric = { group: 'Money', label: 'Revenue minus staff cost', kind: 'money', get: (r) => moneyOf(r).margin, better: 'higher' }

const HOT = 0.85

export default function Results({ results, current, baselineId, onSelectActivity }: Props) {
  if (!current) return <div className="results empty">Run the simulation to see results here.</div>
  const base = results.find((r) => r.scenarioId === baselineId)
  const cmp = base && base !== current ? base : undefined
  const r = current
  const cur = r.currency
  const mo = moneyOf(r)
  const bn = bottleneck(r)
  const maxHist = Math.max(1, ...r.histogram.map((x) => x.count))
  const acts = [...r.activities].sort((a, b) => b.waiting.mean - a.waiting.mean)
  const maxWait = Math.max(1, ...acts.map((a) => a.waiting.mean))
  const roleOf = (id?: string) => r.resources.find((x) => x.id === id)
  const waitShare = r.cycle.mean > 0 ? Math.min(1, r.waiting.mean / r.cycle.mean) : 0
  const workShare = r.cycle.mean > 0 ? Math.min(1 - waitShare, r.processing.mean / r.cycle.mean) : 0
  const totalStaff = r.resources.reduce((a, x) => a + x.paidCost, 0)
  const metrics = comparisonMetrics(results)
  const cycleCi = metricInterval(r, 'cycle')
  const groups = [...new Set(metrics.map((m) => m.group))]
  const title = 'Simulation report'

  return (
    <div className="results">
      {r.warnings.length > 0 && (
        <div className="warnings">
          {r.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      <div className="summary">
        <div className="kpi">
          <div className="kpi-label">Cases served</div>
          <div className="kpi-value">
            {r.casesCompleted} {delta(r.casesCompleted, cmp?.casesCompleted, 'higher')}
          </div>
          <div className="kpi-sub">
            {throughputLabel(r)} · {r.casesStarted} arrived
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Cycle time, average</div>
          <div className="kpi-value">
            {formatDuration(r.cycle.mean)} {delta(r.cycle.mean, cmp?.cycle.mean, 'lower')}
          </div>
          <div className="kpi-sub">
            {cycleCi ? `± ${formatDuration(cycleCi.half)} (95 % CI, ${cycleCi.n} runs) · ` : ''}90 % within {formatDuration(r.cycle.p90)}
          </div>
        </div>
        {r.casesBalked > 0 ? (
          <div className="kpi">
            <div className="kpi-label">Left without service</div>
            <div className="kpi-value bad">
              {r.casesBalked} {delta(r.casesBalked, cmp?.casesBalked, 'lower')}
            </div>
            <div className="kpi-sub">{Math.round((r.casesBalked / (r.casesStarted || 1)) * 100)} % of arrivals</div>
          </div>
        ) : (
          <div className="kpi">
            <div className="kpi-label">Waiting, average</div>
            <div className="kpi-value">
              {formatDuration(r.waiting.mean)} {delta(r.waiting.mean, cmp?.waiting.mean, 'lower')}
            </div>
            <div className="kpi-sub">{Math.round(waitShare * 100)} % of the cycle time</div>
          </div>
        )}
        {bn ? (
          <button className="kpi bottleneck" onClick={() => onSelectActivity(bn.activity.id)} title="Show this activity in the diagram">
            <div className="kpi-label">Biggest bottleneck</div>
            <div className="kpi-value">{bn.activity.name}</div>
            <div className="kpi-sub">
              cases wait {formatDuration(bn.activity.waiting.mean)} here
              {bn.resource && (
                <>
                  {' '}
                  · {bn.resource.name} {Math.round(bn.resource.utilisation * 100)} % busy
                </>
              )}
            </div>
          </button>
        ) : (
          <div className="kpi">
            <div className="kpi-label">Biggest bottleneck</div>
            <div className="kpi-value">None</div>
            <div className="kpi-sub">no case had to wait</div>
          </div>
        )}
      </div>
      {cmp && <p className="hint">Changes compared with {cmp.scenarioName}.</p>}

      <div className="blocks">
        <section className="block">
          <h3>Time and bottlenecks</h3>
          <div className="split" title="Average time per case">
            <span className="wait" style={{ width: `${waitShare * 100}%` }} />
            <span className="work" style={{ width: `${workShare * 100}%` }} />
          </div>
          <div className="legend">
            <span>
              <i className="wait" /> Waiting {formatDuration(r.waiting.mean)}
            </span>
            <span>
              <i className="work" /> Working {formatDuration(r.processing.mean)}
            </span>
            <span className="muted">per case, average</span>
          </div>
          <h4>Where cases wait</h4>
          <table className="tbl">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Waiting</th>
                <th>Working</th>
                <th>Runs</th>
              </tr>
            </thead>
            <tbody>
              {acts.map((a) => (
                <tr key={a.id} onClick={() => onSelectActivity(a.id)} className={bn?.activity === a ? 'peak' : ''}>
                  <td>
                    {a.name}
                    {roleOf(a.resourceId) && <div className="role">{roleOf(a.resourceId)!.name}</div>}
                  </td>
                  <td>
                    <div className="barcell">
                      <span
                        className="bar"
                        style={{
                          width: `${(a.waiting.mean / maxWait) * 100}%`,
                        }}
                      />
                      <span className="txt">{formatDuration(a.waiting.mean)}</span>
                    </div>
                  </td>
                  <td>{formatDuration(a.processing.mean)}</td>
                  <td>
                    {a.count}
                    {a.balked > 0 && <span className="bad"> · {a.balked} left</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.paths.length > 1 && (
            <>
              <h4>By path</h4>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Share</th>
                    <th>Cycle time</th>
                    <th>Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {r.paths.map((p) => (
                    <tr key={p.key}>
                      <td>{p.label}</td>
                      <td>{Math.round(p.share * 100)} %</td>
                      <td>{formatDuration(p.cycle.mean)}</td>
                      <td>{formatDuration(p.waiting.mean)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <h4>Cycle time distribution</h4>
          <div className="hist">
            {r.histogram.map((x, i) => (
              <div
                key={i}
                className="hbar"
                title={`${formatDuration(x.from)} to ${formatDuration(x.to)}: ${x.count} cases`}
                style={{ height: `${(x.count / maxHist) * 100}%` }}
              />
            ))}
          </div>
          <div className="hist-axis">
            <span>{formatDuration(r.histogram[0]?.from ?? 0)}</span>
            <span>{formatDuration(r.histogram[r.histogram.length - 1]?.to ?? 0)}</span>
          </div>
        </section>

        <div className="block-col">
          <section className="block">
            <h3>People</h3>
            {r.resources.length === 0 ? (
              <p className="hint">No roles are assigned to tasks.</p>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>People</th>
                    <th>Busy</th>
                    <th>Busy hours</th>
                    <th>Staff cost</th>
                  </tr>
                </thead>
                <tbody>
                  {r.resources.map((x) => {
                    const old = cmp?.resources.find((y) => y.name === x.name)
                    return (
                      <tr key={x.id}>
                        <td>{x.name}</td>
                        <td>
                          {x.count}
                          {old && old.count !== x.count && (
                            <span className="delta">{x.count > old.count ? `+${x.count - old.count}` : x.count - old.count}</span>
                          )}
                        </td>
                        <td className="busy">
                          <b className={x.utilisation > HOT ? 'bad' : ''}>{Math.round(x.utilisation * 100)} %</b>
                          <div className="track">
                            <span
                              style={{
                                width: `${Math.min(100, x.utilisation * 100)}%`,
                              }}
                              className={x.utilisation > HOT ? 'hot' : ''}
                            />
                          </div>
                        </td>
                        <td>{(x.busySeconds / 3600).toFixed(1)} h</td>
                        <td>{formatMoney(x.paidCost, cur)}</td>
                      </tr>
                    )
                  })}
                </tbody>
                {r.resources.length > 1 && (
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td>{r.resources.reduce((a, x) => a + x.count, 0)}</td>
                      <td />
                      <td>{(r.resources.reduce((a, x) => a + x.busySeconds, 0) / 3600).toFixed(1)} h</td>
                      <td>{formatMoney(totalStaff, cur)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            <p className="hint">Busy is the share of paid working time spent on cases. Above {Math.round(HOT * 100)} %, queues grow quickly.</p>
          </section>

          {(mo.revenue > 0 || mo.staff > 0 || r.cost.sum > 0) && (
            <section className="block">
              <h3>Money</h3>
              <table className="tbl money">
                <tbody>
                  {mo.revenue > 0 && (
                    <tr>
                      <td>Revenue</td>
                      <td>{formatMoney(mo.revenue, cur)}</td>
                      <td className="muted">
                        {formatMoney(mo.revenuePerHour, cur)} / h {delta(mo.revenuePerHour, cmp && moneyOf(cmp).revenuePerHour, 'higher')}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>Staff cost, paid time</td>
                    <td>{formatMoney(mo.staff, cur)}</td>
                    <td className="muted">
                      {formatMoney(mo.staffPerHour, cur)} / h {delta(mo.staffPerHour, cmp && moneyOf(cmp).staffPerHour, 'lower')}
                    </td>
                  </tr>
                  {mo.revenue > 0 && (
                    <tr className="strong">
                      <td>Revenue minus staff cost</td>
                      <td className={mo.margin < 0 ? 'bad' : ''}>{formatMoney(mo.margin, cur)}</td>
                      <td className="muted">
                        <CmpDelta c={cmp ? change(MARGIN, mo.margin, moneyOf(cmp).margin, cur) : null} />
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>Cost per case</td>
                    <td>{formatMoney(mo.perCase, cur)}</td>
                    <td className="muted">work time and fixed costs {delta(mo.perCase, cmp && moneyOf(cmp).perCase, 'lower')}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>

      {results.length > 1 && (
        <section className="block compare">
          <h3>Scenarios side by side</h3>
          <table className="tbl cmp">
            <thead>
              <tr>
                <th />
                {results.map((x) => (
                  <th key={x.scenarioId} className={x === r ? 'active' : ''}>
                    {x.scenarioName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => [
                <tr key={g} className="group">
                  <td colSpan={results.length + 1}>{g}</td>
                </tr>,
                ...metrics
                  .filter((m) => m.group === g)
                  .map((m) => (
                    <tr key={m.label}>
                      <td className="metric">{m.label}</td>
                      {results.map((x) => {
                        const v = m.get(x)
                        const hot = m.kind === 'share' && v !== undefined && v > HOT
                        return (
                          <td key={x.scenarioId} className={x === r ? 'active' : ''}>
                            <span className={hot ? 'bad' : ''}>{formatMetric(m, v, x.currency)}</span>{' '}
                            {x !== base && base && <CmpDelta c={change(m, v, m.get(base), x.currency, significance(m, x, base))} />}
                          </td>
                        )
                      })}
                    </tr>
                  )),
              ])}
            </tbody>
          </table>
          <p className="hint">{runsNote(results)}</p>
        </section>
      )}

      <div className="exports">
        <span className="muted">Export</span>
        <button
          className="ghost"
          onClick={() => download('simulation-report.xlsx', xlsx(reportSheets(results)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
        >
          Report (Excel)
        </button>
        <button className="ghost" onClick={() => printHtml(reportHtml(results, title))} title="Opens the print dialog. Choose “Save as PDF”.">
          Report (PDF)
        </button>
        <button className="ghost" onClick={() => download('results.csv', resultsCsv(results), 'text/csv')}>
          Results (CSV)
        </button>
        <button className="ghost" onClick={() => download(`${r.scenarioName}-log.csv`, logCsv(r), 'text/csv')}>
          Event log (CSV)
        </button>
        <button className="ghost" onClick={() => download(`${r.scenarioName}-log.xes`, logXes(r), 'application/xml')}>
          Event log (XES)
        </button>
      </div>
    </div>
  )
}
