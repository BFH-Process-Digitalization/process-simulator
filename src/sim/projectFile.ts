import { parseXml } from './graph'
import type { Project } from './params'

export const PSIM_NS = 'https://github.com/BitSparkCode/process-simulator/schema/1'

function projectElement(doc: Document): Element | undefined {
  const els = doc.getElementsByTagName('*')
  for (let i = 0; i < els.length; i++) {
    const el = els[i] as Element
    if ((el.localName || el.nodeName.replace(/^.*:/, '')) === 'project' && el.namespaceURI === PSIM_NS) return el
  }
  return undefined
}

/** Reads the project (baseline + variants) stored by this tool. */
export function readProject(xml: string): Project | undefined {
  const el = projectElement(parseXml(xml))
  if (!el) return undefined
  try {
    const p = JSON.parse(el.textContent ?? '') as Project
    if (p && p.baseline && Array.isArray(p.variants)) return p
  } catch {
    return undefined
  }
  return undefined
}

/** Embeds the project (baseline + all scenarios as JSON) into BPMN XML. */
export function embedProject(xml: string, project: Project): string {
  let out = xml.replace(/\s*<psim:project[\s\S]*?<\/psim:project>/g, '')
  const rootMatch = out.match(/<((\w+):)?definitions\b[^>]*>/)
  if (!rootMatch) return xml
  if (!/xmlns:psim=/.test(rootMatch[0])) out = out.replace(rootMatch[0], rootMatch[0].replace(/>$/, ` xmlns:psim="${PSIM_NS}">`))
  const json = JSON.stringify(project).replace(/]]>/g, ']]]]><![CDATA[>')
  const block = `  <psim:project><![CDATA[${json}]]></psim:project>\n`
  return out.replace(/(\s*)<\/((\w+):)?definitions>\s*$/, (_m, _ws, pfx) => `\n${block}</${pfx ?? ''}definitions>\n`)
}
