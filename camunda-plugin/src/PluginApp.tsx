import { useCallback, useEffect, useMemo, useState } from 'react'
import AboutFooter from '../../src/components/About'
import Inspector from '../../src/components/Inspector'
import Player from '../../src/components/Player'
import ResultsDrawer, { DRAWER_DEFAULT } from '../../src/components/ResultsDrawer'
import ScenarioTabs from '../../src/components/ScenarioTabs'
import { annotate, branchLabels as labelBranches, runSignature } from '../../src/components/annotations'
import { setEditable } from '../../src/components/lock'
import { applyOverlays, clearOverlays, drawFrame, type Diagram, type Frame } from '../../src/components/overlays'
import { simulate } from '../../src/sim/engine'
import { buildGraph } from '../../src/sim/graph'
import { completeScenario, defaultScenario, resolve, setValue, type Project } from '../../src/sim/params'
import type { ProcessGraph, SimResult } from '../../src/sim/types'

export interface PluginApi {
  diagram: Diagram
  container: HTMLElement
  read(): Project | undefined
  write(p: Project): void
  /** Current diagram XML without the stored scenarios. */
  modelXml(): Promise<string>
  on(event: string, fn: (e: { newSelection?: { id: string }[] }) => void): () => void
  select(id: string): void
}

function safeGraph(xml: string): ProcessGraph | null {
  if (!xml) return null
  try {
    return buildGraph(xml).graph
  } catch {
    return null
  }
}

export default function PluginApp({ api }: { api: PluginApi }) {
  const [open, setOpen] = useState(false)
  const [xml, setXml] = useState('')
  const [stored, setStored] = useState<Project | undefined>()
  const [scenarioId, setScenarioId] = useState('baseline')
  const [selected, setSelected] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { result: SimResult; sig: string }>>({})
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [drawer, setDrawer] = useState(true)
  const [drawerHeight, setDrawerHeight] = useState(DRAWER_DEFAULT)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => api.modelXml().then(setXml, () => undefined), 250)
    }
    const onImport = () => {
      setStored(api.read())
      setScenarioId('baseline')
      setResults({})
      refresh()
    }
    const offs = [
      api.on('import.done', onImport),
      api.on('commandStack.changed', refresh),
      api.on('psim.project.changed', () => setStored(api.read())),
      api.on('selection.changed', (e) => setSelected(e.newSelection?.[0]?.id ?? null)),
    ]
    onImport()
    return () => {
      offs.forEach((off) => off())
      clearTimeout(timer)
    }
  }, [api])

  const graph = useMemo(() => safeGraph(xml), [xml])
  const project = useMemo(() => stored ?? (graph ? { baseline: defaultScenario(graph), variants: [] } : undefined), [stored, graph])
  const validId = project && (scenarioId === 'baseline' || project.variants.some((v) => v.id === scenarioId)) ? scenarioId : 'baseline'
  const scenario = useMemo(() => (graph && project ? completeScenario(graph, resolve(project, validId)) : null), [graph, project, validId])
  const baseline = useMemo(() => (graph && project ? completeScenario(graph, project.baseline) : null), [graph, project])
  const sig = useMemo(() => (scenario ? runSignature(scenario, xml) : ''), [scenario, xml])

  const current = results[validId]
  const stale = !!current && current.sig !== sig
  const result = current?.result

  const annotations = useMemo(() => (graph && scenario ? annotate(graph, scenario, result, stale) : {}), [graph, scenario, result, stale])
  const branchLabels = useMemo(() => (graph && scenario ? labelBranches(graph, scenario) : {}), [graph, scenario])

  useEffect(() => {
    setEditable(api.diagram, !open)
  }, [api, open])

  useEffect(() => {
    api.container.classList.toggle('psim-on', open)
    try {
      if (open) applyOverlays(api.diagram, annotations, branchLabels)
      else {
        clearOverlays(api.diagram)
        drawFrame(api.diagram, null)
      }
    } catch {
      /* diagram not imported yet */
    }
  }, [api, open, annotations, branchLabels])

  const onFrame = useCallback((f: Frame | null) => drawFrame(api.diagram, f), [api])

  const run = async (all: boolean) => {
    if (!project || !graph) return
    setRunning(true)
    setNotice('')
    await new Promise((r) => setTimeout(r, 20))
    try {
      const ids = all ? ['baseline', ...project.variants.map((v) => v.id)] : [validId]
      const next: typeof results = {}
      for (const id of ids) {
        const sc = completeScenario(graph, resolve(project, id))
        next[id] = { result: simulate(graph, sc), sig: runSignature(sc, xml) }
      }
      setResults((prev) => ({ ...prev, ...next }))
      setDrawer(true)
    } catch (e) {
      setNotice('Simulation failed: ' + (e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const allResults = project ? ['baseline', ...project.variants.map((v) => v.id)].map((id) => results[id]?.result).filter((r): r is SimResult => !!r) : []

  return (
    <>
      <button className={'psim-toggle' + (open ? ' open' : '')} onClick={() => setOpen(!open)} title={open ? 'Close the simulation to edit the diagram again' : 'Simulate this process: times, people, scenarios. The diagram is locked meanwhile.'}>
        {open ? 'Close simulation' : 'Simulation'}
      </button>
      {open && (
        <div className="psim-layout">
          <div className="psim-main">
            <div className="psim-spacer" />
            {project && graph && (
              <ScenarioTabs
                project={project}
                scenarioId={validId}
                onSelect={setScenarioId}
                onProject={api.write}
                running={running}
                stale={stale}
                canRun={!!graph}
                onRun={run}
              />
            )}
            {notice && (
              <div className="notice" onClick={() => setNotice('')}>
                {notice}
              </div>
            )}
            {result && !stale && <Player result={result} onFrame={onFrame} />}
            {result && (
              <ResultsDrawer
                results={allResults}
                current={result}
                stale={stale}
                open={drawer}
                onToggle={() => setDrawer(!drawer)}
                height={drawerHeight}
                onHeight={setDrawerHeight}
                onSelectActivity={api.select}
              />
            )}
          </div>
          <aside className="side">
            {graph && scenario && baseline && project ? (
              <Inspector
                graph={graph}
                scenario={scenario}
                baseline={baseline}
                isVariant={validId !== 'baseline'}
                selected={selected}
                onSet={(key, value) => api.write(setValue(project, validId, key, value))}
              />
            ) : (
              <p className="hint pad">The model could not be read.</p>
            )}
            <AboutFooter />
          </aside>
        </div>
      )}
    </>
  )
}
