import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Project } from '../../src/sim/params'
import PluginApp, { type PluginApi } from './PluginApp'

interface EventBus {
  on(event: string, fn: (e: never) => unknown): void
  off(event: string, fn: (e: never) => unknown): void
  fire(event: string, data?: object): void
}
interface Definitions {
  project?: { body?: string }
}
interface BpmnJS {
  getDefinitions(): Definitions | undefined
  saveXML(o: { format: boolean }): Promise<{ xml?: string }>
  get<T = unknown>(name: string): T
}
type Moddle = { create(type: string, attrs: object): { body?: string } }
type CommandStack = { register(name: string, handler: object): void; execute(name: string, ctx: object): void }
type Canvas = { getContainer(): HTMLElement }

const UPDATE = 'psim.updateProject'
const CHANGED = 'psim.project.changed'

function SimulationPlugin(eventBus: EventBus, canvas: Canvas, bpmnjs: BpmnJS, commandStack: CommandStack, moddle: Moddle) {
  const read = (): Project | undefined => {
    const body = bpmnjs.getDefinitions()?.project?.body
    if (!body) return undefined
    try {
      const p = JSON.parse(body) as Project
      return p && p.baseline && Array.isArray(p.variants) ? p : undefined
    } catch {
      return undefined
    }
  }
  const store = (body: string | undefined) => {
    const defs = bpmnjs.getDefinitions()
    if (!defs) return
    defs.project = body ? moddle.create('psim:Project', { body }) : undefined
    eventBus.fire(CHANGED)
  }

  // Scenario edits go through the command stack, so the tab is marked unsaved and undo works.
  commandStack.register(UPDATE, {
    execute(ctx: { body: string; old?: string }) {
      ctx.old = bpmnjs.getDefinitions()?.project?.body
      store(ctx.body)
      return []
    },
    revert(ctx: { body: string; old?: string }) {
      store(ctx.old)
      return []
    },
  })

  const container = canvas.getContainer()
  const host = document.createElement('div')
  host.className = 'psim-ui'
  for (const type of ['wheel', 'mousedown', 'pointerdown', 'dblclick', 'contextmenu']) host.addEventListener(type, (e) => e.stopPropagation())
  container.appendChild(host)

  const api: PluginApi = {
    diagram: bpmnjs,
    container,
    read,
    write: (p) => commandStack.execute(UPDATE, { body: JSON.stringify(p) }),
    async modelXml() {
      const { xml } = await bpmnjs.saveXML({ format: false })
      return (xml ?? '').replace(/<psim:project>[\s\S]*?<\/psim:project>/, '')
    },
    on(event, fn) {
      eventBus.on(event, fn as (e: never) => unknown)
      return () => eventBus.off(event, fn as (e: never) => unknown)
    },
    select(id) {
      const el = bpmnjs.get<{ get(id: string): unknown }>('elementRegistry').get(id)
      if (el) bpmnjs.get<{ select(e: unknown): void }>('selection').select(el)
    },
  }

  const root = createRoot(host)
  root.render(createElement(PluginApp, { api }))
  eventBus.on('diagram.destroy', () => {
    root.unmount()
    host.remove()
  })
}
SimulationPlugin.$inject = ['eventBus', 'canvas', 'bpmnjs', 'commandStack', 'moddle']

export default {
  __init__: ['processSimulator'],
  processSimulator: ['type', SimulationPlugin],
}
