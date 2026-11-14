import { PSIM_NS } from '../../src/sim/projectFile'

/** bpmn-moddle extension: lets the modeler read and write the scenarios stored in a .bpmn file. */
export const descriptor = {
  name: 'ProcessSimulator',
  uri: PSIM_NS,
  prefix: 'psim',
  xml: { tagAlias: 'lowerCase' },
  types: [
    { name: 'Project', superClass: ['Element'], properties: [{ name: 'body', isBody: true, type: 'String' }] },
    { name: 'SimulationDefinitions', extends: ['bpmn:Definitions'], properties: [{ name: 'project', type: 'Project' }] },
  ],
}
