import type { Diagram } from './overlays'

interface Bus {
  on(events: string | string[], priority: number, fn: (e: { element?: { parent?: unknown } }) => unknown): void
}
interface Stack {
  execute(command: string, context: object): unknown
  undo(): unknown
  redo(): unknown
}
interface Actions {
  trigger(action: string, opts?: unknown): unknown
}

/** Commands that still run while editing is locked: they only change simulation settings. */
const ALLOWED_COMMANDS = new Set(['psim.updateProject'])
const ALLOWED_ACTIONS = new Set(['stepZoom', 'zoom', 'selectElements', 'find'])

const CSS = `.psim-locked .djs-palette, .psim-locked .djs-context-pad, .psim-locked .djs-popup, .psim-locked .djs-resizer,
.psim-locked .djs-bendpoint, .psim-locked .djs-segment-dragger { display: none !important; }`

const state = new WeakMap<object, { locked: boolean }>()

/** Switches diagram editing on or off. Selecting, zooming and panning keep working. */
export function setEditable(diagram: Diagram, editable: boolean) {
  let s = state.get(diagram)
  if (!s) {
    const st = { locked: false }
    s = st
    state.set(diagram, st)
    if (!document.getElementById('psim-lock-style')) {
      const style = document.createElement('style')
      style.id = 'psim-lock-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }
    const bus = diagram.get<Bus>('eventBus')
    bus.on('element.mousedown', 5000, (e) => (st.locked && e.element?.parent ? false : undefined))
    bus.on(['element.dblclick', 'keyboard.keydown'], 5000, () => (st.locked ? false : undefined))
    const stack = diagram.get<Stack>('commandStack')
    const execute = stack.execute.bind(stack)
    const undo = stack.undo.bind(stack)
    const redo = stack.redo.bind(stack)
    stack.execute = (command, context) => (st.locked && !ALLOWED_COMMANDS.has(command) ? undefined : execute(command, context))
    stack.undo = () => (st.locked ? undefined : undo())
    stack.redo = () => (st.locked ? undefined : redo())
    try {
      const actions = diagram.get<Actions>('editorActions')
      const trigger = actions.trigger.bind(actions)
      actions.trigger = (action, opts) => (st.locked && !ALLOWED_ACTIONS.has(action) ? undefined : trigger(action, opts))
    } catch {
      /* no editor actions in this diagram */
    }
  }
  s.locked = !editable
  diagram.get<{ getContainer(): HTMLElement }>('canvas').getContainer().classList.toggle('psim-locked', !editable)
  if (!editable) {
    try {
      diagram.get<{ close(): void }>('contextPad').close()
      diagram.get<{ cancel(): void }>('directEditing').cancel()
    } catch {
      /* not available */
    }
  }
}
