import { useState } from 'react'
import { addVariant, changeCount, type Project } from '../sim/params'

interface Props {
  project: Project
  scenarioId: string
  onSelect: (id: string) => void
  onProject: (p: Project) => void
  running: boolean
  stale: boolean
  canRun: boolean
  onRun: (all: boolean) => void
}

export default function ScenarioTabs({ project, scenarioId, onSelect, onProject, running, stale, canRun, onRun }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null)

  const newScenario = () => {
    const src = project.variants.find((v) => v.id === scenarioId)
    const [proj, id] = addVariant(project, src ? `${src.name} (copy)` : `Scenario ${project.variants.length + 1}`, { ...(src?.overrides ?? {}) })
    onProject(proj)
    onSelect(id)
    setRenaming(id)
  }

  const removeScenario = (id: string) => {
    onProject({ ...project, variants: project.variants.filter((v) => v.id !== id) })
    if (scenarioId === id) onSelect('baseline')
  }

  return (
    <nav className="scenarios">
      {[{ id: 'baseline', name: 'Baseline', overrides: {} }, ...project.variants].map((v) => (
        <div
          key={v.id}
          className={'tab' + (v.id === scenarioId ? ' active' : '')}
          onClick={() => onSelect(v.id)}
          onDoubleClick={() => v.id !== 'baseline' && setRenaming(v.id)}
        >
          {renaming === v.id ? (
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              defaultValue={v.name}
              onBlur={(e) => {
                const name = e.target.value.trim() || v.name
                if (name !== v.name) onProject({ ...project, variants: project.variants.map((x) => (x.id === v.id ? { ...x, name } : x)) })
                setRenaming(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <span>{v.name}</span>
          )}
          {v.id !== 'baseline' && (
            <>
              <span className="badge" title="Only these values differ from the baseline">
                {changeCount(v)} change{changeCount(v) === 1 ? '' : 's'}
              </span>
              <button
                className="icon"
                title="Delete scenario"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Delete scenario "${v.name}"?`)) removeScenario(v.id)
                }}
              >
                ×
              </button>
            </>
          )}
        </div>
      ))}
      <button className="tab add" onClick={newScenario} title="Copies the current scenario. You only change what is different.">
        + New scenario
      </button>
      <div className="spacer" />
      <button className="secondary" disabled={running || !canRun} onClick={() => onRun(true)}>
        Run all
      </button>
      <button className="primary" disabled={running || !canRun} onClick={() => onRun(false)}>
        {running ? 'Simulating…' : stale ? 'Run again' : 'Run simulation'}
      </button>
    </nav>
  )
}
