import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Results from './Results'
import ValueStream from './ValueStream'
import type { SimResult } from '../sim/types'

export const DRAWER_DEFAULT = 46
export const DRAWER_MIN = 15
export const DRAWER_MAX = 85

const TABS = [
  { id: 'results', label: 'Results', title: 'Time, people, money and the scenario comparison' },
  { id: 'value', label: 'Value stream', title: 'Value-adding time, waste and waiting along the process' },
] as const
type Tab = (typeof TABS)[number]['id']
const TAB_KEY = 'process-simulator:results-tab'

interface Props {
  results: SimResult[]
  current: SimResult
  stale: boolean
  open: boolean
  onToggle: () => void
  /** Height in percent of the column the panel sits in. */
  height: number
  onHeight: (h: number) => void
  onSelectActivity: (id: string) => void
}

export default function ResultsDrawer({ results, current, stale, open, onToggle, height, onHeight, onSelectActivity }: Props) {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem(TAB_KEY) === 'value' ? 'value' : 'results'))
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      /* layout preference only */
    }
  }, [tab])
  const resize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const col = e.currentTarget.parentElement?.parentElement
    if (!col) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const rect = col.getBoundingClientRect()
    const move = (ev: PointerEvent) => onHeight(Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, ((rect.bottom - ev.clientY) / rect.height) * 100)))
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
  }

  return (
    <div className={'drawer' + (open ? ' open' : '')} style={open ? { height: `${height}%` } : undefined}>
      {open && (
        <div
          className="drawer-handle"
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize. Double-click to reset."
          onPointerDown={resize}
          onDoubleClick={() => onHeight(DRAWER_DEFAULT)}
        />
      )}
      <div className="drawer-bar">
        <div className="drawer-tabs" role="tablist" aria-label="Results view">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={open && tab === t.id}
              className={open && tab === t.id ? 'on' : ''}
              title={t.title}
              onClick={() => {
                setTab(t.id)
                if (!open) onToggle()
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {stale && <span className="stale">Out of date, run again</span>}
        <button className="drawer-toggle" onClick={onToggle}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open &&
        (tab === 'value' ? (
          <div className="results" role="tabpanel">
            <ValueStream result={current} onSelectActivity={onSelectActivity} />
          </div>
        ) : (
          <Results results={results} current={current} baselineId="baseline" onSelectActivity={onSelectActivity} />
        ))}
    </div>
  )
}
