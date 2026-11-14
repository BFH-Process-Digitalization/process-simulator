import { descriptor } from './descriptor'
import simulationModule from './module'

// Camunda Modeler collects client plugins from this global list.
const w = window as unknown as { plugins?: { plugin: unknown; type: string }[] }
w.plugins = w.plugins || []
w.plugins.push({ plugin: descriptor, type: 'bpmn.modeler.moddleExtension' }, { plugin: simulationModule, type: 'bpmn.modeler.additionalModules' })
