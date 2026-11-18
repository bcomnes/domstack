import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'
import { ESLint } from 'eslint'
import { neostandard } from 'neostandard'

const sourceURL = new URL('../lib/defaults/default.root.layout.ts', import.meta.url)
const outputURL = new URL('../lib/defaults/default.root.layout.js', import.meta.url)

/** @param {string} source */
export async function generateDefaultRootLayout (source) {
  const { code } = await transform(source, {
    loader: 'ts',
    format: 'esm',
    target: 'esnext',
    // This is a standalone module, not JavaScript embedded in an HTML script tag.
    supported: { 'inline-script': false },
    legalComments: 'inline',
  })
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: neostandard({ env: ['browser'], ts: true }),
    fix: true,
  })
  const generated = `// Generated from default.root.layout.ts by npm run build:defaults. Do not edit.\n${code}`
  const [result] = await eslint.lintText(generated, { filePath: fileURLToPath(outputURL) })
  if (!result) throw new Error('ESLint returned no result for the generated default layout')
  if (result.errorCount || result.warningCount) {
    throw new Error(await (await eslint.loadFormatter('stylish')).format([result]))
  }
  return result.output ?? generated
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = await readFile(sourceURL, 'utf8')
  await writeFile(outputURL, await generateDefaultRootLayout(source))
}
