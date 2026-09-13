import { readFile, writeFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const sourceURL = new URL('../lib/defaults/default.root.layout.ts', import.meta.url)
const outputURL = new URL('../lib/defaults/default.root.layout.js', import.meta.url)
const source = await readFile(sourceURL, 'utf8')
const { code } = await transform(source, {
  loader: 'ts',
  format: 'esm',
  target: 'es2022',
  legalComments: 'inline',
})
await writeFile(outputURL, `// Generated from default.root.layout.ts by npm run build:defaults. Do not edit.\n${code}`)
