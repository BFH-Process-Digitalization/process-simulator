import type { ReactNode } from 'react'
import { branchFlows } from '../sim/graph'
import { branchProbabilities } from '../sim/engine'
import { OFFICE_HOURS, dist, newId, readKey, type OverrideKey } from '../sim/params'
import { WEEKDAYS } from '../sim/time'
import type { ElementParams, GNode, ProcessGraph, Resource, Scenario, Timetable } from '../sim/types'
import DurationInput from './DurationInput'

interface Props {
  graph: ProcessGraph
  scenario: Scenario
  baseline: Scenario
  isVariant: boolean
  selected: string | null
  onSet: (key: OverrideKey, value: unknown) => void
}

const TYPE_LABEL: Record<string, string> = {
  task: 'Task',
  userTask: 'User task',
  serviceTask: 'Service task',
  sendTask: 'Send task',
  receiveTask: 'Receive task',
  manualTask: 'Manual task',
  businessRuleTask: 'Business rule task',
  scriptTask: 'Script task',
  callActivity: 'Call activity',
  subProcess: 'Subprocess',
  exclusiveGateway: 'Exclusive gateway',
  inclusiveGateway: 'Inclusive gateway',
  parallelGateway: 'Parallel gateway',
  eventBasedGateway: 'Event-based gateway',
  complexGateway: 'Complex gateway',
  startEvent: 'Start event',
  endEvent: 'End event',
  intermediateCatchEvent: 'Intermediate event',
  intermediateThrowEvent: 'Intermediate event',
  boundaryEvent: 'Boundary event',
}

function Field({ label, changed, onReset, children }: { label: string; changed?: boolean; onReset?: () => void; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {changed && (
          <button className="link changed" title="Changed in this scenario. Click to use the baseline value." onClick={onReset}>
            changed · reset
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

export default function Inspector(props: Props) {
  const { graph, selected } = props
  const node = selected ? graph.nodes[selected] : undefined
  const flow = selected ? graph.flows[selected] : undefined
  if (flow) {
    const src = graph.nodes[flow.source]
    if (src && branchFlows(graph, src.id).length) return <ElementPanel {...props} node={src} />
  }
  if (node && node.kind !== 'start') return <ElementPanel {...props} node={node} />
  return <ProcessPanel {...props} />
}

function changedFn(props: Props) {
  return (key: OverrideKey) =>
    props.isVariant && JSON.stringify(readKey(props.scenario, key) ?? null) !== JSON.stringify(readKey(props.baseline, key) ?? null)
}

function ProcessPanel(props: Props) {
  const { scenario: s, onSet, baseline } = props
  const changed = changedFn(props)
  const reset = (key: OverrideKey) => () => onSet(key, readKey(baseline, key))
  return (
    <div className="inspector">
      <header>
        <div className="eyebrow">Process</div>
        <h2>{props.graph.name}</h2>
        <p className="hint">Click a task, gateway or event in the diagram to set its times and probabilities.</p>
      </header>
      <section>
        <h3>Demand</h3>
        <Field label="New cases arrive" changed={changed('arrival')} onReset={reset('arrival')}>
          <DurationInput value={s.arrival} onChange={(d) => onSet('arrival', d)} />
        </Field>
        <Field label="Cases arrive" changed={changed('arrivalTimetableId')} onReset={reset('arrivalTimetableId')}>
          <select value={s.arrivalTimetableId ?? ''} onChange={(e) => onSet('arrivalTimetableId', e.target.value || undefined)}>
            <option value="">at any time</option>
            {s.timetables.map((t) => (
              <option key={t.id} value={t.id}>
                only during {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Simulate" changed={changed('cases') || changed('horizon')} onReset={() => { reset('cases')(); reset('horizon')() }}>
          <div className="row">
            <select value={s.horizon ? 'time' : 'cases'} onChange={(e) => onSet('horizon', e.target.value === 'time' ? 8 * 3600 : undefined)}>
              <option value="cases">a number of cases</option>
              <option value="time">a period of time</option>
            </select>
            {s.horizon ? (
              <>
                <input className="num" type="number" min={0.5} step={0.5} value={Math.round((s.horizon / 3600) * 100) / 100} onChange={(e) => onSet('horizon', Math.max(0.1, parseFloat(e.target.value) || 1) * 3600)} />
                <span className="muted">hours of arrivals</span>
              </>
            ) : (
              <input
                className="num"
                type="number"
                min={1}
                max={20000}
                value={s.cases}
                onChange={(e) => onSet('cases', Math.min(20000, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              />
            )}
          </div>
        </Field>
        <Field label="First case arrives" changed={changed('startDate')} onReset={reset('startDate')}>
          <input
            type="datetime-local"
            value={s.startDate.slice(0, 16)}
            onChange={(e) => e.target.value && onSet('startDate', new Date(e.target.value + ':00Z').toISOString())}
          />
        </Field>
      </section>
      <Resources {...props} />
      <section>
        <h3>Statistics</h3>
        <div className="grid2">
          <Field label="Runs per scenario" changed={changed('replications')} onReset={reset('replications')}>
            <input
              className="num wide"
              type="number"
              min={1}
              max={200}
              value={s.replications ?? 1}
              onChange={(e) => onSet('replications', Math.min(200, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            />
          </Field>
          <Field label="Warm-up (hours left out)" changed={changed('warmup')} onReset={reset('warmup')}>
            <input
              className="num wide"
              type="number"
              min={0}
              step={1}
              value={(s.warmup ?? 0) / 3600}
              onChange={(e) => onSet('warmup', Math.max(0, parseFloat(e.target.value) || 0) * 3600)}
            />
          </Field>
        </div>
        <p className="hint">
          Every scenario is simulated this many times; run i of every scenario uses the same random numbers. Results show
          averages and 95 % confidence intervals. Cases arriving during the warm-up are left out of the statistics.
        </p>
        {s.trim > 0 && (
          <Field label={`Leave out first and last ${Math.round(s.trim * 100)} % of cases`} changed={changed('trim')} onReset={reset('trim')}>
            <input type="range" min={0} max={0.3} step={0.05} value={s.trim} onChange={(e) => onSet('trim', parseFloat(e.target.value))} />
          </Field>
        )}
        <div className="grid2">
          <Field label="Currency" changed={changed('currency')} onReset={reset('currency')}>
            <select value={s.currency} onChange={(e) => onSet('currency', e.target.value)}>
              {['CHF', 'EUR', 'USD', 'GBP'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Random seed" changed={changed('seed')} onReset={reset('seed')}>
            <input className="num wide" type="number" value={s.seed} onChange={(e) => onSet('seed', parseInt(e.target.value, 10) || 1)} />
          </Field>
        </div>
      </section>
    </div>
  )
}

function Resources(props: Props) {
  const { scenario: s, onSet, baseline } = props
  const changed = changedFn(props)
  const setRes = (r: Resource) => onSet('resource:' + r.id, r)
  const add = () => {
    const id = newId('res')
    onSet('resource:' + id, { id, name: 'New role', count: 1, costPerHour: 50, timetableId: s.timetables[0]?.id ?? OFFICE_HOURS.id })
  }
  const used = (id: string) => Object.values(s.elements).filter((e) => e.resourceId === id).length
  return (
    <section>
      <h3>People and systems</h3>
      <div className="res-list">
        {s.resources.map((r) => (
          <div className={'res' + (changed('resource:' + r.id) ? ' is-changed' : '')} key={r.id}>
            <div className="res-top">
              <input className="name" value={r.name} onChange={(e) => setRes({ ...r, name: e.target.value })} />
              <button className="icon" title="Remove" onClick={() => onSet('resource:' + r.id, null)}>
                ×
              </button>
            </div>
            <div className="res-row">
              <label>
                <span>People</span>
                <span className="stepper">
                  <button onClick={() => setRes({ ...r, count: Math.max(0, r.count - 1) })}>−</button>
                  <b>{r.count}</b>
                  <button onClick={() => setRes({ ...r, count: r.count + 1 })}>+</button>
                </span>
              </label>
              <label>
                <span>Cost / h</span>
                <input className="num" type="number" min={0} value={r.costPerHour} onChange={(e) => setRes({ ...r, costPerHour: parseFloat(e.target.value) || 0 })} />
              </label>
            </div>
            <label className="res-hours">
              <span>Works</span>
              <select value={r.timetableId} onChange={(e) => setRes({ ...r, timetableId: e.target.value })}>
                {s.timetables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="hint">
              {used(r.id)} task{used(r.id) === 1 ? '' : 's'}
              {changed('resource:' + r.id) && (
                <button className="link changed" onClick={() => onSet('resource:' + r.id, readKey(baseline, 'resource:' + r.id))}>
                  changed · reset
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <button className="ghost" onClick={add}>
        + Add role
      </button>
      <Timetables {...props} />
    </section>
  )
}

function Timetables({ scenario: s, onSet }: Props) {
  const set = (t: Timetable) => onSet('timetable:' + t.id, t)
  return (
    <details className="timetables">
      <summary>Working hours</summary>
      {s.timetables.map((t) => (
        <div className="tt" key={t.id}>
          <input className="name" value={t.name} onChange={(e) => set({ ...t, name: e.target.value })} />
          {t.rules.map((r, i) => {
            const upd = (patch: Partial<typeof r>) => set({ ...t, rules: t.rules.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div className="tt-rule" key={i}>
                <select value={r.fromDay} onChange={(e) => upd({ fromDay: +e.target.value })}>
                  {WEEKDAYS.map((d, k) => (
                    <option key={d} value={k}>
                      {d}
                    </option>
                  ))}
                </select>
                <span className="muted">to</span>
                <select value={r.toDay} onChange={(e) => upd({ toDay: +e.target.value })}>
                  {WEEKDAYS.map((d, k) => (
                    <option key={d} value={k}>
                      {d}
                    </option>
                  ))}
                </select>
                <input type="time" value={r.from} onChange={(e) => upd({ from: e.target.value })} />
                <input type="time" value={r.to === '24:00' ? '23:59' : r.to} onChange={(e) => upd({ to: e.target.value === '23:59' ? '24:00' : e.target.value })} />
              </div>
            )
          })}
          <button className="link" onClick={() => set({ ...t, rules: [...t.rules, { fromDay: 5, toDay: 5, from: '09:00', to: '13:00' }] })}>
            + add hours
          </button>
        </div>
      ))}
      <button
        className="ghost"
        onClick={() => {
          const id = newId('tt')
          onSet('timetable:' + id, { id, name: 'Shift', rules: [{ fromDay: 0, toDay: 4, from: '06:00', to: '14:00' }] })
        }}
      >
        + Add working hours
      </button>
    </details>
  )
}

function ElementPanel(props: Props & { node: GNode }) {
  const { node, scenario: s, onSet, graph, baseline } = props
  const changed = changedFn(props)
  const key = 'element:' + node.id
  const p: ElementParams = s.elements[node.id] ?? {}
  const setP = (patch: Partial<ElementParams>) => onSet(key, { ...p, ...patch })
  const reset = () => onSet(key, readKey(baseline, key))
  const branches = branchFlows(graph, node.id)
  const isWork = node.kind === 'task' || (node.kind === 'subprocess' && !node.starts.length)
  const title = node.name || TYPE_LABEL[node.type] || node.type
  const eventLabel = node.eventDef !== 'none' ? ` · ${node.eventDef}` : ''

  return (
    <div className="inspector">
      <header>
        <div className="eyebrow">
          {TYPE_LABEL[node.type] ?? node.type}
          {eventLabel}
        </div>
        <h2>{title}</h2>
      </header>
      {isWork && (
        <section>
          <Field label="Done by" changed={changed(key)} onReset={reset}>
            <select value={p.resourceId ?? ''} onChange={(e) => setP({ resourceId: e.target.value || undefined })}>
              <option value="">Nobody (automated, no waiting)</option>
              {s.resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.count})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Working time">
            <DurationInput value={p.duration ?? dist('normal', 900, 'minutes', { sd: 225 })} onChange={(d) => setP({ duration: d })} />
          </Field>
          <Field label="Value for the customer">
            <select value={p.value ?? ''} onChange={(e) => setP({ value: (e.target.value || undefined) as ElementParams['value'] })}>
              <option value="">Not classified</option>
              <option value="va">Value-adding: the customer would pay for it</option>
              <option value="bva">Business value-adding: needed, e.g. by law</option>
              <option value="nva">Waste: could be removed</option>
            </select>
          </Field>
          <div className="grid2">
            <Field label={`Fixed cost per run (${s.currency})`}>
              <input className="num wide" type="number" min={0} value={p.fixedCost ?? 0} onChange={(e) => setP({ fixedCost: parseFloat(e.target.value) || 0 })} />
            </Field>
            <Field label={`Revenue per run (${s.currency})`}>
              <input className="num wide" type="number" min={0} value={p.revenue ?? 0} onChange={(e) => setP({ revenue: parseFloat(e.target.value) || undefined })} />
            </Field>
            {node.multiInstance && (
              <Field label={`Instances (${node.multiInstance.sequential ? 'one after another' : 'in parallel'})`}>
                <input className="num wide" type="number" min={1} value={p.instances ?? node.multiInstance.cardinality ?? 3} onChange={(e) => setP({ instances: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
              </Field>
            )}
          </div>
          {p.resourceId && (
            <Field label="Queue limit">
              <div className="row">
                <select value={p.maxQueue === undefined ? 'wait' : 'leave'} onChange={(e) => setP({ maxQueue: e.target.value === 'leave' ? 5 : undefined })}>
                  <option value="wait">Cases always wait their turn</option>
                  <option value="leave">Cases leave when more than … wait</option>
                </select>
                {p.maxQueue !== undefined && (
                  <input className="num" type="number" min={0} value={p.maxQueue} onChange={(e) => setP({ maxQueue: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                )}
              </div>
            </Field>
          )}
          {node.loop && (
            <Field label={`Repeated in ${Math.round((p.repeatProbability ?? 0.2) * 100)} % of runs`}>
              <input type="range" min={0} max={0.9} step={0.05} value={p.repeatProbability ?? 0.2} onChange={(e) => setP({ repeatProbability: parseFloat(e.target.value) })} />
            </Field>
          )}
        </section>
      )}
      {node.kind === 'subprocess' && node.starts.length > 0 && (
        <section>
          <p className="hint">Times are set on the tasks inside the subprocess.</p>
          <Field label={`Fixed cost per run (${s.currency})`}>
            <input className="num wide" type="number" min={0} value={p.fixedCost ?? 0} onChange={(e) => setP({ fixedCost: parseFloat(e.target.value) || 0 })} />
          </Field>
        </section>
      )}
      {node.kind === 'catch' && node.eventDef !== 'link' && (
        <section>
          <Field label={node.eventDef === 'timer' ? 'Waits for' : `Time until the ${node.eventDef} arrives`} changed={changed(key)} onReset={reset}>
            <DurationInput value={p.duration ?? dist('fixed', node.timerDuration ?? 3600, 'hours')} onChange={(d) => setP({ duration: d })} />
          </Field>
        </section>
      )}
      {node.kind === 'boundary' && (
        <section>
          {node.eventDef === 'timer' ? (
            <Field label="Fires when the activity takes longer than" changed={changed(key)} onReset={reset}>
              <DurationInput value={p.duration ?? dist('fixed', node.timerDuration ?? 86400, 'hours')} onChange={(d) => setP({ duration: d })} />
            </Field>
          ) : (
            <Field label={`Happens in ${Math.round((p.probability ?? 0) * 100)} % of runs`} changed={changed(key)} onReset={reset}>
              <input type="range" min={0} max={1} step={0.01} value={p.probability ?? 0} onChange={(e) => setP({ probability: parseFloat(e.target.value) })} />
            </Field>
          )}
          <p className="hint">{node.cancelActivity ? 'Interrupting: the activity stops and the case continues here.' : 'Non-interrupting: the activity keeps running, an extra path starts here.'}</p>
        </section>
      )}
      {node.boundaries.length > 0 && (
        <section>
          <h3>Attached events</h3>
          <p className="hint">Select an attached event in the diagram to set when it happens.</p>
          <ul className="plain">
            {node.boundaries.map((b) => {
              const bn = graph.nodes[b]
              const bp = s.elements[b] ?? {}
              return (
                <li key={b}>
                  {bn.name || bn.eventDef} · {bn.eventDef === 'timer' ? `after ${bp.duration ? Math.round(bp.duration.mean / 3600) + ' h' : '?'}` : `${Math.round((bp.probability ?? 0) * 100)} %`}
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {branches.length > 0 && <Branches {...props} node={node} />}
      {node.kind === 'and' && <p className="hint pad">Parallel gateway: every outgoing path is taken; a joining one waits for all incoming paths.</p>}
      {node.kind === 'end' && <p className="hint pad">{node.eventDef === 'terminate' ? 'Ends the whole case, including other running paths.' : 'Ends this path of the case.'}</p>}
    </div>
  )
}

function Branches(props: Props & { node: GNode }) {
  const { node, graph, scenario: s, onSet, baseline } = props
  const changed = changedFn(props)
  const flows = branchFlows(graph, node.id)
  const probs = branchProbabilities(graph, s, node.id)
  const exclusive = node.kind !== 'or' && !(node.kind !== 'xor' && node.kind !== 'eventGateway' && node.kind !== 'complex')
  const label = (fid: string) => {
    const f = graph.flows[fid]
    const t = graph.nodes[f.target]
    return f.name || `to ${t?.name || t?.type || f.target}`
  }
  const setProb = (fid: string, v: number) => {
    if (!exclusive) {
      onSet('flow:' + fid, v)
      return
    }
    const others = flows.filter((f) => f.id !== fid)
    const rest = others.reduce((a, f) => a + probs[f.id], 0)
    onSet('flow:' + fid, v)
    for (const f of others) {
      const share = rest > 0 ? probs[f.id] / rest : 1 / others.length
      onSet('flow:' + f.id, Math.round((1 - v) * share * 1000) / 1000)
    }
  }
  return (
    <section>
      <h3>{exclusive ? 'Which way do cases go?' : 'How often is each path taken?'}</h3>
      <p className="hint">{exclusive ? 'Shares always add up to 100 %.' : 'Inclusive gateway: each path is decided on its own, several can run at once.'}</p>
      {flows.map((f) => (
        <div className="branch" key={f.id}>
          <div className="field-label">
            <span>{label(f.id)}</span>
            {changed('flow:' + f.id) && (
              <button className="link changed" onClick={() => onSet('flow:' + f.id, readKey(baseline, 'flow:' + f.id))}>
                changed · reset
              </button>
            )}
          </div>
          <div className="row">
            <input type="range" min={0} max={1} step={0.01} value={probs[f.id] ?? 0} onChange={(e) => setProb(f.id, parseFloat(e.target.value))} />
            <span className="pct">{Math.round((probs[f.id] ?? 0) * 100)} %</span>
          </div>
        </div>
      ))}
    </section>
  )
}
