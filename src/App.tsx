import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AboutFooter from './components/About'
import Inspector from './components/Inspector'
import Modeler, { type ModelerHandle, type Frame } from './components/Modeler'
import Player from './components/Player'
import ResultsDrawer, { DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN } from './components/ResultsDrawer'
import ScenarioTabs from './components/ScenarioTabs'
import { annotate, branchLabels as labelBranches, runSignature } from './components/annotations'
import { buildGraph } from './sim/graph'
import { completeScenario, resolve, setValue, type Project } from './sim/params'
import { embedProject } from './sim/projectFile'
import { download } from './sim/export'
import { runInWorker } from './sim/run'
import type { ProcessGraph, SimResult } from './sim/types'
import { BLANK, EXAMPLE, loadSaved, projectFromFile, save, type Saved } from './state'

function safeGraph(xml: string): ProcessGraph | null {
  try {
    return buildGraph(xml).graph
  } catch {
    return null
  }
}

export default function App() {
  const [state, setState] = useState<Saved | null>(() => loadSaved() ?? null)
  const [loadKey, setLoadKey] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { result: SimResult; sig: string }>>({})
  const [running, setRunning] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'failed' | 'idle'>('idle')
  const [notice, setNotice] = useState('')
  const [drawer, setDrawer] = useState(() => localStorage.getItem(DRAWER_KEY) !== 'closed')
  const [drawerHeight, setDrawerHeight] = useState(() => {
    const v = parseFloat(localStorage.getItem(DRAWER_HEIGHT_KEY) ?? '')
    return v >= DRAWER_MIN && v <= DRAWER_MAX ? v : DRAWER_DEFAULT
  })
  const [mode, setMode] = useState<'model' | 'simulate'>(() => (localStorage.getItem(MODE_KEY) === 'model' ? 'model' : 'simulate'))
  const modeler = useRef<ModelerHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const open = useCallback((xml: string, fileName: string, nextMode: 'model' | 'simulate' = 'simulate') => {
    try {
      const { project, source } = projectFromFile(xml)
      setState({ xml, project, fileName, scenarioId: 'baseline' })
      setResults({})
      setSelected(null)
      setLoadKey((k) => k + 1)
      setMode(nextMode)
      setNotice(
        source === 'defaults' ? 'Opened. Times are rough defaults: click a task to set them.' : 'Opened with all saved scenarios.',
      )
    } catch (e) {
      setNotice('Could not open this file: ' + (e as Error).message)
    }
  }, [])

  const openSample = useCallback(
    async (file: string, name: string) => {
      const res = await fetch(import.meta.env.BASE_URL + file)
      open(await res.text(), name + '.bpmn')
    },
    [open],
  )

  useEffect(() => {
    if (!state) openSample(EXAMPLE.file, EXAMPLE.name)
  }, [state, openSample])

  useEffect(() => {
    if (!state) return
    const t = setTimeout(() => setSaveStatus(save(state) ? 'saved' : 'failed'), 150)
    return () => clearTimeout(t)
  }, [state])

  const graph = useMemo(() => (state ? safeGraph(state.xml) : null), [state?.xml]) // eslint-disable-line react-hooks/exhaustive-deps
  const project = state?.project
  const scenarioId = state?.scenarioId ?? 'baseline'
  const scenario = useMemo(() => (graph && project ? completeScenario(graph, resolve(project, scenarioId)) : null), [graph, project, scenarioId])
  const baseline = useMemo(() => (graph && project ? completeScenario(graph, project.baseline) : null), [graph, project])
  const sig = useMemo(() => (scenario && state ? runSignature(scenario, state.xml) : ''), [scenario, state?.xml]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = results[scenarioId]
  const stale = !!current && current.sig !== sig
  const result = current?.result

  const update = (fn: (s: Saved) => Saved) => setState((s) => (s ? fn(s) : s))
  const setProject = (fn: (p: Project) => Project) => update((s) => ({ ...s, project: fn(s.project) }))
  const onSet = (key: string, value: unknown) => setProject((p) => setValue(p, scenarioId, key, value))

  const runOne = async (id: string) => {
    if (!state || !graph) return
    const sc = completeScenario(graph, resolve(state.project, id))
    const r = await runInWorker(state.xml, sc)
    setResults((prev) => ({ ...prev, [id]: { result: r, sig: runSignature(sc, state.xml) } }))
  }

  const run = async (all: boolean) => {
    if (!state) return
    setRunning(true)
    try {
      const ids = all ? ['baseline', ...state.project.variants.map((v) => v.id)] : [scenarioId]
      for (const id of ids) await runOne(id)
      setDrawer(true)
    } catch (e) {
      setNotice('Simulation failed: ' + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const exportBpmn = async () => {
    if (!state || !modeler.current) return
    const xml = await modeler.current.saveXML()
    download(state.fileName.replace(/\.(bpmn|xml)$/i, '') + '.bpmn', embedProject(xml, state.project), 'application/xml')
  }

  useEffect(() => {
    try {
      localStorage.setItem(DRAWER_KEY, drawer ? 'open' : 'closed')
      localStorage.setItem(DRAWER_HEIGHT_KEY, String(Math.round(drawerHeight)))
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* layout preference only */
    }
  }, [drawer, drawerHeight, mode])

  const onFrame = useCallback((f: Frame | null) => modeler.current?.drawFrame(f), [])

  const simulating = mode === 'simulate'
  const annotations = useMemo(() => (simulating && graph && scenario ? annotate(graph, scenario, result, stale) : {}), [simulating, graph, scenario, result, stale])
  const branchLabels = useMemo(() => (simulating && graph && scenario ? labelBranches(graph, scenario) : {}), [simulating, graph, scenario])

  useEffect(() => {
    if (!simulating) modeler.current?.drawFrame(null)
  }, [simulating])

  if (!state || !project || !scenario || !baseline) return <div className="boot">Loading…</div>

  const allResults = ['baseline', ...project.variants.map((v) => v.id)].map((id) => results[id]?.result).filter((r): r is SimResult => !!r)

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img className="logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <b>Process Simulator</b>
          <input className="filename" value={state.fileName} onChange={(e) => update((s) => ({ ...s, fileName: e.target.value }))} />
          <span className={'save ' + saveStatus} title="Every change is stored in this browser immediately. Export to keep a file.">
            {saveStatus === 'failed' ? 'Not saved: browser storage full' : saveStatus === 'saved' ? 'Saved in browser' : ''}
          </span>
        </div>
        <div className="mode" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={!simulating} className={simulating ? '' : 'on'} onClick={() => setMode('model')} title="Draw and change the process diagram">
            Model
          </button>
          <button role="tab" aria-selected={simulating} className={simulating ? 'on' : ''} onClick={() => setMode('simulate')} title="Set times, people and scenarios and run the simulation. The diagram is locked.">
            Simulate
          </button>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => openSample(EXAMPLE.file, EXAMPLE.name)}>
            Example
          </button>
          <button className="ghost" onClick={() => open(BLANK, 'New process.bpmn', 'model')}>
            New
          </button>
          <button className="ghost" onClick={() => fileInput.current?.click()}>
            Open .bpmn
          </button>
          <button className="ghost" onClick={exportBpmn} title="BPMN 2.0 file with the model and all scenarios.">
            Export .bpmn
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".bpmn,.xml"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) open(await f.text(), f.name)
              e.target.value = ''
            }}
          />
        </div>
      </header>

      {simulating && (
      <ScenarioTabs
        project={project}
        scenarioId={scenarioId}
        onSelect={(id) => update((s) => ({ ...s, scenarioId: id }))}
        onProject={(p) => setProject(() => p)}
        running={running}
        stale={stale}
        canRun={!!graph}
        onRun={run}
      />
      )}

      {notice && (
        <div className="notice" onClick={() => setNotice('')}>
          {notice}
          <span className="muted"> · dismiss</span>
        </div>
      )}

      <main className="body">
        <div className="canvas-col">
          <Modeler
            ref={modeler}
            xml={state.xml}
            loadKey={loadKey}
            onChange={(xml) => update((s) => ({ ...s, xml }))}
            onSelect={setSelected}
            annotations={annotations}
            branchLabels={branchLabels}
            onImportError={(m) => setNotice('The diagram could not be shown: ' + m)}
            editable={!simulating}
          />
          {simulating && result && !stale && <Player result={result} onFrame={onFrame} />}
          {simulating && result && (
            <ResultsDrawer
              results={allResults}
              current={result}
              stale={stale}
              open={drawer}
              onToggle={() => setDrawer(!drawer)}
              height={drawerHeight}
              onHeight={setDrawerHeight}
              onSelectActivity={setSelected}
            />
          )}
        </div>
        <aside className="side">
          {!simulating ? (
            <div className="inspector">
              <header>
                <div className="eyebrow">Model</div>
                <h2>Draw the process</h2>
              </header>
              <p className="hint pad">
                Use the tools on the left to add tasks, gateways and events, and drag them to connect. Switch to <b>Simulate</b> to set times, people and scenarios and to run the simulation.
              </p>
            </div>
          ) : graph ? (
            <>
              <Inspector graph={graph} scenario={scenario} baseline={baseline} isVariant={scenarioId !== 'baseline'} selected={selected} onSet={onSet} />
            </>
          ) : (
            <p className="hint pad">The model could not be read.</p>
          )}
        </aside>
      </main>
      <AboutFooter />
    </div>
  )
}

const DRAWER_KEY = 'process-simulator:results-panel'
const DRAWER_HEIGHT_KEY = 'process-simulator:results-height'
const MODE_KEY = 'process-simulator:mode'
