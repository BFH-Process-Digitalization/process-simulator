import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import BpmnModeler from 'bpmn-js/lib/Modeler'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css'
import { setEditable } from './lock'
import { applyOverlays, drawFrame, type Annotation, type Diagram, type Frame } from './overlays'

export type { Annotation, Frame } from './overlays'

export interface ModelerHandle {
  saveXML(): Promise<string>
  drawFrame(frame: Frame | null): void
  fit(): void
}

interface Props {
  xml: string
  loadKey: number
  onChange: (xml: string) => void
  onSelect: (id: string | null) => void
  annotations: Record<string, Annotation>
  branchLabels: Record<string, string>
  onImportError: (msg: string) => void
  editable: boolean
}

const Modeler = forwardRef<ModelerHandle, Props>(function Modeler(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const modeler = useRef<BpmnModeler | null>(null)
  const cb = useRef(props)
  cb.current = props

  useEffect(() => {
    const m = new BpmnModeler({ container: host.current! })
    modeler.current = m
    let timer: ReturnType<typeof setTimeout> | undefined
    m.on('commandStack.changed', () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const { xml } = await m.saveXML({ format: true })
        if (xml) cb.current.onChange(xml)
      }, 250)
    })
    m.on('selection.changed', (e: { newSelection: { id: string }[] }) => {
      const s = e.newSelection[0]
      cb.current.onSelect(s ? s.id : null)
    })
    return () => {
      clearTimeout(timer)
      m.destroy()
    }
  }, [])

  useEffect(() => {
    const m = modeler.current
    if (!m) return
    m.importXML(props.xml)
      .then(() => (m.get('canvas') as { zoom(v: string): void }).zoom('fit-viewport'))
      .catch((err: Error) => {
        if (modeler.current === m) cb.current.onImportError(err.message)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.loadKey])

  useEffect(() => {
    if (modeler.current) setEditable(modeler.current as unknown as Diagram, props.editable)
  }, [props.editable])

  useEffect(() => {
    const m = modeler.current as unknown as Diagram | null
    if (!m) return
    const apply = () => applyOverlays(m, cb.current.annotations, cb.current.branchLabels)
    try {
      apply()
    } catch {
      /* diagram not ready yet */
    }
    const handler = () => setTimeout(apply, 0)
    const bus = m as unknown as { on(e: string, f: () => void): void; off(e: string, f: () => void): void }
    bus.on('import.done', handler)
    return () => bus.off('import.done', handler)
  }, [props.annotations, props.branchLabels])

  useImperativeHandle(ref, () => ({
    async saveXML() {
      const { xml } = await modeler.current!.saveXML({ format: true })
      return xml ?? ''
    },
    fit() {
      ;(modeler.current?.get('canvas') as { zoom(v: string): void } | undefined)?.zoom('fit-viewport')
    },
    drawFrame(frame) {
      if (modeler.current) drawFrame(modeler.current as unknown as Diagram, frame)
    },
  }))

  return <div className="modeler" ref={host} />
})

export default Modeler
