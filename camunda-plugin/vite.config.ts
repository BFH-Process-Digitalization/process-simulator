import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const here = import.meta.dirname

function scopeRule(head: string, body: string): string {
  const out: string[] = []
  let rules = ''
  for (const s of head
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (s === ':root') {
      out.push('.psim-ui')
      const vars = body.split(';').filter((d) => d.trim().startsWith('--'))
      rules += `.psim-on {${vars.join(';')};}\n`
    } else if (/^(html|body|#root)$/.test(s) || s.startsWith('.bjs-')) continue
    else if (/^\.(sim-|tok-|djs-)/.test(s)) out.push('.psim-on ' + s)
    else out.push('.psim-ui ' + s)
  }
  return (out.length ? `${out.join(', ')} {${body}}\n` : '') + rules
}

/** Scopes the app stylesheet so it only applies inside the plugin and never to the rest of the modeler. */
export function scopeCss(css: string): string {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let out = ''
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const head = css.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    for (; j < css.length && depth; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0
    const body = css.slice(open + 1, j - 1)
    if (head.startsWith('@keyframes')) out += `${head} {${body}}\n`
    else if (head.startsWith('@')) out += `${head} {\n${scopeCss(body)}}\n`
    else out += scopeRule(head, body)
    i = j
  }
  return out
}

function pluginFiles(): Plugin {
  return {
    name: 'camunda-plugin-files',
    generateBundle() {
      const css = scopeCss(readFileSync(resolve(here, '../src/styles.css'), 'utf8')) + readFileSync(resolve(here, 'src/plugin.css'), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'client/style.css', source: css })
      this.emitFile({ type: 'asset', fileName: 'index.js', source: readFileSync(resolve(here, 'index.js'), 'utf8') })
      this.emitFile({
        type: 'asset',
        fileName: 'package.json',
        source: JSON.stringify({ name: 'process-simulator-camunda-plugin', private: true, type: 'commonjs' }, null, 2) + '\n',
      })
      for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
        const file = resolve(here, '..', name)
        if (existsSync(file)) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(file, 'utf8') })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), pluginFiles()],
  define: { 'process.env.NODE_ENV': '"production"' },
  publicDir: false,
  build: {
    outDir: resolve(here, 'dist/process-simulator'),
    emptyOutDir: true,
    lib: { entry: resolve(here, 'src/client.ts'), formats: ['iife'], name: 'ProcessSimulatorPlugin', fileName: () => 'client/client.js' },
  },
})
