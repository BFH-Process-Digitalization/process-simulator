import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  entryPoints: ['src/cli/procsim.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist-cli/procsim.mjs',
  banner: { js: '#!/usr/bin/env node\n// Process Simulator. (c) 2026 Bern University of Applied Sciences (BFH), Prof. Moritz Maier. Apache-2.0.' },
  define: { __VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
})
