import { DOMParser } from '@xmldom/xmldom'

const g = globalThis as unknown as { DOMParser?: unknown }
g.DOMParser ??= DOMParser
