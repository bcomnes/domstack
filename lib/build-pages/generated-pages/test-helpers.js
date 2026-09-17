import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
const __dirname = import.meta.dirname
const fixturePrefix = '.tmp-'

/**
 * @param {string} src
 * @param {string} relname
 * @param {string} content
 */
export async function writeFixtureFile (src, relname, content) {
  const filepath = join(src, relname)
  await mkdir(dirname(filepath), { recursive: true })
  await writeFile(filepath, content)
}

/**
 * @param {Record<string, string>} files
 * @param {(paths: { src: string, dest: string }) => Promise<void>} run
 */
export async function withTempFixture (files, run) {
  const root = await mkdtemp(join(__dirname, fixturePrefix))
  const src = join(root, 'src')
  const dest = join(root, 'dist')
  await mkdir(src, { recursive: true })

  for (const [relname, content] of Object.entries(files)) {
    await writeFixtureFile(src, relname, content)
  }

  try {
    await run({ src, dest })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export const minimalRootLayout = `import { html, raw, render } from 'fragtml'

export default function rootLayout ({ vars, children }) {
  return render(html\`<!doctype html><title>\${vars.title}</title><main>\${typeof children === 'string' ? raw(children) : children}</main>\`)
}
`

export const minimalGlobalVars = `export default { layout: 'root', title: 'Test' }
`

export const assetAwareRootLayout = `export default function rootLayout ({ styles = [], scripts = [], children }) {
  return '<!doctype html><html><head>' +
    styles.map(href => '<link rel="stylesheet" href="' + href + '">').join('') +
    scripts.map(src => '<script type="module" src="' + src + '"></script>').join('') +
    '</head><body>' + children + '</body></html>'
}
`

/**
 * @param {unknown} error
 * @returns {Error & {
 *   code?: string,
 *   conflict?: {
 *     outputPath: string,
 *     a: { type: string, path: string },
 *     b: { type: string, path: string }
 *   },
 *   pagesFile?: { pagesFile: { relname: string } }
 * }}
 */
export function firstGeneratedPagesError (error) {
  if (!(error instanceof AggregateError)) throw new TypeError('Expected an AggregateError')
  const generatedError = error.errors[0]
  if (!(generatedError instanceof Error)) throw new TypeError('Expected a generated-pages Error')
  return generatedError
}
