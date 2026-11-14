import { buildGraph } from './graph'
import { replicate } from './replicate'
import type { Scenario, SimResult } from './types'

export interface RunRequest {
  id: number
  xml: string
  scenario: Scenario
}

export type RunResponse = { id: number; result: SimResult } | { id: number; error: string }

self.onmessage = (e: MessageEvent<RunRequest>) => {
  const { id, xml, scenario } = e.data
  try {
    const { graph } = buildGraph(xml)
    const result = replicate(graph, scenario)
    ;(self as unknown as Worker).postMessage({ id, result } satisfies RunResponse)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies RunResponse)
  }
}
