import type { Scenario, SimResult } from './types'
import type { RunRequest, RunResponse } from './worker'

let worker: Worker | undefined
let seq = 0
const pending = new Map<number, { resolve: (r: SimResult) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<RunResponse>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if ('error' in e.data) p.reject(new Error(e.data.error))
      else p.resolve(e.data.result)
    }
  }
  return worker
}

export function runInWorker(xml: string, scenario: Scenario): Promise<SimResult> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, xml, scenario } satisfies RunRequest)
  })
}
