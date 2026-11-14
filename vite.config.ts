import { existsSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

function notices(): Plugin {
  return {
    name: 'third-party-notices',
    apply: 'build',
    generateBundle() {
      for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'])
        if (existsSync(name)) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(name, 'utf8') })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), notices()],
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts', 'camunda-plugin/**/*.test.ts'] },
})
