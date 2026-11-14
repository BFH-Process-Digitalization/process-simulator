import LICENCE_TEXT from '../LICENSE?raw'
import NOTICES_TEXT from '../THIRD_PARTY_NOTICES.md?raw'

export const APP_NAME = 'Process Simulator'
export const AUTHOR = 'Prof. Moritz Maier'
export const INSTITUTION = 'Bern University of Applied Sciences (BFH)'
export const HOLDER = `${INSTITUTION}, ${AUTHOR}`
export const COPYRIGHT = `© 2026 ${HOLDER}.`
export const LICENCE =
  'Open source under the Apache License, Version 2.0. You may use, modify and redistribute it, provided you keep the copyright and NOTICE file and mark your changes.'
export const REPO_URL = 'https://github.com/BFH-Process-Digitalization/process-simulator'
export const LICENCE_URL = `${REPO_URL}/blob/main/LICENSE`
export const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`
export const THIRD_PARTY = 'Built on bpmn-js by bpmn.io, React and other open source packages, each used under its own licence.'

export { LICENCE_TEXT }

export interface Notice {
  name: string
  licence: string
  text: string
}

/** The packages and licence texts from THIRD_PARTY_NOTICES.md. */
export function parseNotices(md: string): Notice[] {
  const licences = new Map<string, string>()
  for (const m of md.matchAll(/^\| (\S+) \| (\S+) \| ([^|]+) \|/gm)) licences.set(`${m[1]} ${m[2]}`, m[3].trim())
  return md
    .split(/^## /m)
    .slice(1)
    .map((section) => {
      const name = section.slice(0, section.indexOf('\n')).trim()
      const text = /```text\n([\s\S]*?)\n```/.exec(section)?.[1] ?? ''
      return { name, licence: licences.get(name) ?? '', text }
    })
}

export const NOTICES = parseNotices(NOTICES_TEXT)
