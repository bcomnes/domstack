import { test } from 'node:test'
import assert from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import * as cheerio from 'cheerio'
import { DomStack, testBuild } from '../../index.js'

const __dirname = import.meta.dirname

/**
 * @param {string} src
 * @param {string} relname
 * @param {string} content
 */
async function writeFixtureFile (src, relname, content) {
  const filepath = join(src, relname)
  await mkdir(dirname(filepath), { recursive: true })
  await writeFile(filepath, content)
}

/**
 * @param {Record<string, string>} files
 * @param {(paths: { src: string, dest: string }) => Promise<void>} run
 */
async function withTempFixture (files, run) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-generated-pages-'))
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

const minimalRootLayout = `export default function rootLayout ({ vars, children }) {
  return '<!doctype html><title>' + vars.title + '</title><main>' + children + '</main>'
}
`

const minimalGlobalVars = `export default { layout: 'root', title: 'Test' }
`

/**
 * @param {unknown} error
 * @returns {string}
 */
function aggregateErrorMessage (error) {
  if (!(error instanceof Error)) return String(error)
  const aggregate = /** @type {Error & { errors?: Error[] }} */ (error)
  return String(aggregate.errors?.[0]?.message ?? aggregate.message)
}

test.describe('generated pages', () => {
  test('builds generated pages through layouts and exposes them to global data and templates', async (t) => {
    const src = join(__dirname, './src')
    const build = await testBuild(src)
    const { results, readOutput } = build

    t.after(async () => {
      await build.cleanup()
    })

    assert.equal(results.siteData.pagesFiles.length, 4, 'four pages files are discovered')

    const redirectHtml = await readOutput('old-url/index.html')
    assert.match(redirectHtml, /<meta http-equiv="refresh" content="0;url=\/new-url\/">/, 'redirect page renders through redirect layout')
    assert.match(redirectHtml, /<a href="\/new-url\/">\/new-url\/<\/a>/, 'redirect target is rendered')

    const blogIndexHtml = await readOutput('blog/2024/index.html')
    const blogIndexDoc = cheerio.load(blogIndexHtml)
    assert.equal(blogIndexDoc('#post-count').text(), '1', 'generated blog index can inspect concrete blog pages')

    const introspectionHtml = await readOutput('generated-introspection/index.html')
    const introspectionDoc = cheerio.load(introspectionHtml)
    assert.equal(introspectionDoc('#saw-generated').text(), 'false', 'pages files receive concrete pages only')
    assert.equal(introspectionDoc('meta[name="generated-page-count"]').attr('content'), '4', 'global.data sees generated pages after pages files run')

    const stylesheetHrefs = Array.from(introspectionDoc('link[rel="stylesheet"]')).map(link => introspectionDoc(link).attr('href') ?? '')
    assert.ok(stylesheetHrefs.some(href => href.startsWith('/global-') && href.endsWith('.css')), 'generated page includes global stylesheet')
    assert.ok(stylesheetHrefs.some(href => href.startsWith('/root.layout-') && href.endsWith('.css')), 'generated page includes layout stylesheet')
    assert.ok(!stylesheetHrefs.some(href => href.startsWith('./style-')), 'generated page does not include page-local stylesheet')

    const scriptSrcs = Array.from(introspectionDoc('script[type="module"]')).map(script => introspectionDoc(script).attr('src') ?? '')
    assert.ok(scriptSrcs.some(src => src.startsWith('/global.client-') && src.endsWith('.js')), 'generated page includes global client')
    assert.ok(scriptSrcs.some(src => src.startsWith('/root.layout.client-') && src.endsWith('.js')), 'generated page includes layout client')
    assert.ok(!scriptSrcs.some(src => src.startsWith('./client-')), 'generated page does not include page-local client')

    const asyncHtml = await readOutput('async-generated/index.html')
    assert.match(asyncHtml, /async generated page/, 'async iterable pages files are supported')

    const summary = JSON.parse(await readOutput('summary.json'))
    assert.equal(summary.generatedPageCount, 4, 'template vars include global.data generated page count')
    assert.equal(summary.generatedPagesInTemplate, 4, 'template pages include generated pages')
  })

  test('throws a conflict error for generated pages that collide with concrete pages', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'README.md': '# Concrete root page\n',
      'conflict.pages.js': `export default function () {
  return { outputName: 'index.html', vars: { title: 'Generated root' }, children: 'generated' }
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      await assert.rejects(
        () => domstack.build(),
        error => {
          assert.match(aggregateErrorMessage(error), /Output path conflict/)
          return true
        }
      )
    })
  })

  test('throws a clear error for invalid generated page paths', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'invalid.pages.js': `export default function () {
  return { outputName: '../outside/index.html', vars: { title: 'Invalid' }, children: 'invalid' }
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      await assert.rejects(
        () => domstack.build(),
        error => {
          assert.match(aggregateErrorMessage(error), /must not contain "\.\." segments/)
          return true
        }
      )
    })
  })
})
