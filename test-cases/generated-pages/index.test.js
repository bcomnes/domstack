import { test } from 'node:test'
import assert from 'node:assert'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import * as cheerio from 'cheerio'
import { DomStack, testBuild } from '../../index.js'
import globalData from './src/global.data.js'

const __dirname = import.meta.dirname
const fixturePrefix = '.tmp-'

async function cleanupTempFixtures () {
  const entries = await readdir(__dirname, { withFileTypes: true })
  await Promise.all(entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(fixturePrefix))
    .map(entry => rm(join(__dirname, entry.name), { recursive: true, force: true })))
}

test.before(cleanupTempFixtures)
test.after(cleanupTempFixtures)

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

const minimalRootLayout = `import { html, raw, render } from 'fragtml'

export default function rootLayout ({ vars, children }) {
  return render(html\`<!doctype html><title>\${vars.title}</title><main>\${typeof children === 'string' ? raw(children) : children}</main>\`)
}
`

const minimalGlobalVars = `export default { layout: 'root', title: 'Test' }
`

const assetAwareRootLayout = `export default function rootLayout ({ styles = [], scripts = [], children }) {
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
function firstGeneratedPagesError (error) {
  if (!(error instanceof AggregateError)) throw new TypeError('Expected an AggregateError')
  const generatedError = error.errors[0]
  if (!(generatedError instanceof Error)) throw new TypeError('Expected a generated-pages Error')
  return generatedError
}

/**
 * @param {any[]} pages
 */
function collectRedirects (pages) {
  const data = globalData(/** @type {any} */ ({ pages }))
  if (data instanceof Promise) throw new TypeError('Expected synchronous global data')
  return data.redirects
}

test.describe('generated pages', () => {
  test('validates page-owned redirect metadata with destination context', () => {
    /**
     * @param {string} relname
     * @param {string} url
     * @param {unknown} redirectFrom
     */
    const page = (relname, url, redirectFrom) => /** @type {any} */ ({
      vars: { redirectFrom },
      pageInfo: { path: relname.replace(/\/README\.md$/, ''), url, pageFile: { relname } },
    })

    assert.deepEqual(collectRedirects([
      page('current/README.md', '/current/', ['/old/', '/older/']),
    ]), [
      { from: '/old/', to: '/current/' },
      { from: '/older/', to: '/current/' },
    ])

    assert.throws(
      () => collectRedirects([page('string/README.md', '/string/', '/old/')]),
      /redirectFrom on "string\/README\.md" must be an array/
    )
    assert.throws(
      () => collectRedirects([page('number/README.md', '/number/', [42])]),
      /redirectFrom entries on "number\/README\.md" must be strings/
    )

    for (const redirectFrom of ['https://example.com/old/', '//example.com/old/', '/old/?draft=true', '/../escape/']) {
      assert.throws(
        () => collectRedirects([page('invalid/README.md', '/invalid/', [redirectFrom])]),
        error => error instanceof Error && error.message.includes(redirectFrom) && error.message.includes('invalid/README.md')
      )
    }

    assert.throws(
      () => collectRedirects([
        page('first/README.md', '/first/', ['/shared-old/']),
        page('second/README.md', '/second/', ['/shared-old/']),
      ]),
      /redirectFrom "\/shared-old\/" is declared by both "first\/README\.md" and "second\/README\.md"/
    )
  })

  test('builds generated pages from global data and exposes the final page set to templates', async (t) => {
    const src = join(__dirname, './src')
    const build = await testBuild(src)
    const { results, readOutput } = build

    t.after(async () => {
      await build.cleanup()
    })

    assert.equal(results.siteData.pagesFiles.length, 4, 'four pages files are discovered')
    assert.equal(results.siteData.pages.length, 7, 'siteData.pages contains the seven source-backed pages')
    assert.equal(results.siteData.pages.some(page => Boolean(page.generated)), false, 'siteData.pages remains discovery-only')

    const redirectCases = [
      { from: 'old-url', to: '/new-url/', destination: 'new-url/index.html', heading: 'New URL' },
      { from: 'legacy-url', to: '/new-url/', destination: 'new-url/index.html', heading: 'New URL' },
      { from: 'docs/old-guide', to: '/guides/current/', destination: 'guides/current/index.html', heading: 'Current Guide' },
      { from: 'company', to: '/about/', destination: 'about/index.html', heading: 'About' },
    ]

    for (const { from, to, destination, heading } of redirectCases) {
      const redirectHtml = await readOutput(`${from}/index.html`)
      assert.match(redirectHtml, new RegExp(`<meta http-equiv="refresh" content="0;url=${to}">`), `${from} renders through the redirect layout`)
      assert.match(redirectHtml, new RegExp(`<a href="${to}">${to}</a>`), `${from} links to its canonical destination`)
      const destinationHtml = await readOutput(destination)
      assert.match(destinationHtml, new RegExp(`<h1[^>]*>${heading}</h1>`), `${to} is backed by a concrete page`)
      assert.match(destinationHtml, /<meta name="source-page-count" content="7">/, `${to} receives global data at final render time`)
    }

    const blog2024IndexDoc = cheerio.load(await readOutput('blog/2024/index.html'))
    const blog2024Links = blog2024IndexDoc('.blog-entry-link').toArray().map(link => ({
      href: blog2024IndexDoc(link).attr('href'),
      title: blog2024IndexDoc(link).text().trim(),
    }))
    const blog2024Dates = blog2024IndexDoc('.blog-entry-date').toArray().map(time => blog2024IndexDoc(time).text().trim())
    assert.deepEqual(blog2024Links, [
      { href: '/blog/2024/post-two/', title: 'Post Two' },
      { href: '/blog/2024/post-one/', title: 'Post One' },
    ], 'generated yearly indexes link concrete posts newest-first')
    assert.deepEqual(blog2024Dates, ['2024-06-15', '2024-01-02'], 'generated yearly indexes render publication dates')

    const blog2023IndexDoc = cheerio.load(await readOutput('blog/2023/index.html'))
    assert.deepEqual(blog2023IndexDoc('.blog-entry-link').toArray().map(link => ({
      href: blog2023IndexDoc(link).attr('href'),
      title: blog2023IndexDoc(link).text().trim(),
    })), [
      { href: '/blog/2023/older-post/', title: 'Older Post' },
    ], 'a generated index is created for each year with posts')

    const introspectionHtml = await readOutput('generated-introspection/index.html')
    const introspectionDoc = cheerio.load(introspectionHtml)
    assert.equal(introspectionDoc('#saw-generated').text(), 'false', 'pages files receive concrete pages only')
    assert.equal(introspectionDoc('meta[name="source-page-count"]').attr('content'), '7', 'global.data sees source-backed pages before pages files run')

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
    assert.equal(summary.sourcePageCount, 7, 'template vars include global.data source page count')
    assert.equal(summary.blogPostCount, 3, 'template vars include the collection used by pages files')
    assert.equal(summary.generatedPagesInTemplate, 8, 'template pages include generated pages')
  })

  test('supports static object, static array, and async function exports', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'single.pages.js': `export default {
  outputName: 'single/index.html',
  children: '<p>single static page</p>',
}
`,
      'multiple.pages.js': `export default [
  { outputName: 'multiple/one.html', children: '<p>first static page</p>' },
  { outputName: 'multiple/two.html', children: '<p>second static page</p>' },
]
`,
      'async.pages.js': `export default async function () {
  return { outputName: 'async/index.html', children: '<p>async function page</p>' }
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      await domstack.build()

      assert.match(await readFile(join(dest, 'single/index.html'), 'utf8'), /single static page/)
      assert.match(await readFile(join(dest, 'multiple/one.html'), 'utf8'), /first static page/)
      assert.match(await readFile(join(dest, 'multiple/two.html'), 'utf8'), /second static page/)
      assert.match(await readFile(join(dest, 'async/index.html'), 'utf8'), /async function page/)
    })
  })

  test('builds generated drafts when buildDrafts is enabled', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'draft.pages.js': `export default {
  outputName: 'draft/index.html',
  draft: true,
  children: '<p>generated draft</p>',
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest, { buildDrafts: true })
      await domstack.build()

      assert.match(await readFile(join(dest, 'draft/index.html'), 'utf8'), /generated draft/)
    })
  })

  test('returns copyable generated vars and keeps global-data PageData values inside the worker', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'global.data.js': `export default function globalData ({ pages }) {
  return { posts: pages }
}
`,
      'README.md': '# Concrete page\n',
      'indexes.pages.js': `export default function indexesPages ({ vars }) {
  return {
    outputName: 'generated-index/index.html',
    vars: {
      title: 'Generated index',
      posts: vars.posts,
    },
    children: ({ vars }) => \`<p id="post-count">\${vars.posts.length}</p>\`,
  }
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      const results = await domstack.build()
      const output = await readFile(join(dest, 'generated-index/index.html'), 'utf8')
      const outputRecord = results.pageBuildResults?.outputs.find(output => output.outputRelname === 'generated-index/index.html')

      assert.match(output, /<p id="post-count">1<\/p>/, 'generated page renders with the PageData collection from global.data')
      assert.ok(outputRecord, 'generated page emits an output record')
      assert.equal(outputRecord.pageVars?.['title'], 'Generated index', 'copyable page vars are returned')
      assert.equal(Object.hasOwn(outputRecord.pageVars ?? {}, 'posts'), false, 'PageData values stay inside the worker')
    })
  })

  test('returns generated render errors without sending render state', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'broken.pages.js': `export default {
  outputName: 'broken/index.html',
  children () {
    throw new Error('generated boom', { cause: () => {} })
  },
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      await assert.rejects(
        () => domstack.build(),
        error => {
          const aggregate = /** @type {Error & { errors?: Array<Error & { page?: { path?: string, generated?: { pagesFile?: { pagesFile?: { relname?: string } } } } }> }} */ (error)
          const generatedError = aggregate.errors?.find(error => error.page?.generated)

          assert.ok(generatedError, 'build includes the generated page error')
          assert.match(generatedError.message, /page: "broken"/)
          assert.equal(generatedError.page?.generated?.pagesFile?.pagesFile?.relname, 'broken.pages.js')
          assert.notEqual(generatedError.name, 'DataCloneError')
          assert.equal(/** @type {{ message?: string } | undefined} */ (generatedError.cause)?.message, 'generated boom')
          return true
        }
      )
    })
  })

  test('returns pages-file context when a generated-pages function throws', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'broken.pages.js': `export default function () {
  throw new Error('pages factory boom', { cause: () => {} })
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      await assert.rejects(
        () => domstack.build(),
        error => {
          const generatedError = firstGeneratedPagesError(error)

          assert.match(generatedError.message, /pages factory boom/)
          assert.match(generatedError.message, /pages file: "broken\.pages\.js"/)
          assert.equal(generatedError.pagesFile?.pagesFile.relname, 'broken.pages.js')
          assert.notEqual(generatedError.name, 'DataCloneError')
          assert.equal(/** @type {{ message?: string } | undefined} */ (generatedError.cause)?.message, 'pages factory boom')
          return true
        }
      )
    })
  })

  test('includes generated pages in the domstack manifest as page entries', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'archive.pages.js': `export default {
  outputName: 'archive/index.html',
  vars: {
    layout: 'root',
    title: 'Archive',
    archiveYear: 2024,
    manifestRole: 'generated-index',
  },
  children: '<p>Generated archive</p>',
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest, {
        domstackManifest: {
          manifestVars: ['archiveYear'],
        },
      })
      const results = await domstack.build()
      const entry = results.domstackManifest?.entries.find(entry => entry.outputRelname === 'archive/index.html')
      const outputRecord = results.pageBuildResults?.outputs.find(output => output.outputRelname === 'archive/index.html')

      assert.ok(entry, 'generated page is present in the domstack manifest')
      assert.equal(outputRecord?.pageVars?.['archiveYear'], 2024, 'copyable page vars are returned from the worker')
      assert.equal(entry.kind, 'page')
      assert.equal(entry.url, '/archive/')
      assert.equal(entry.sourceRelname, 'archive.pages.js#0')
      assert.equal(entry.pagePath, 'archive')
      assert.equal(entry.pageUrl, '/archive/')
      assert.deepEqual(entry.page, {
        path: 'archive',
        url: '/archive/',
      })
      assert.equal(entry.role, 'generated-index', 'generated page vars can override the manifest role')
      assert.deepEqual(entry.manifestVars, {
        archiveYear: 2024,
      }, 'selected generated page vars are exposed in the manifest')
      assert.match(entry.revision ?? '', /^[a-f0-9]{64}$/, 'generated page content is revisioned')
    })
  })

  test('supports function manifest transforms with generated vars', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'archive.pages.js': `export default {
  outputName: 'archive/index.html',
  vars: {
    title: 'Archive',
    archive: { year: 2024 },
  },
  children ({ vars }) {
    vars.archive.year = 2025
    return '<p>Generated archive</p>'
  },
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest, {
        domstackManifest: {
          manifestVars: ({ vars }) => {
            const archive = /** @type {{ year: number } | undefined} */ (vars['archive'])
            return archive ? { archiveLabel: String(archive.year) } : {}
          },
        },
      })
      const results = await domstack.build()
      const entry = results.domstackManifest?.entries.find(entry => entry.outputRelname === 'archive/index.html')
      const outputRecord = results.pageBuildResults?.outputs.find(output => output.outputRelname === 'archive/index.html')

      assert.deepEqual(entry?.manifestVars, { archiveLabel: '2025' })
      assert.deepEqual(outputRecord?.pageVars?.['archive'], { year: 2025 }, 'function transforms receive complete post-render page vars')
    })
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
          const generatedError = firstGeneratedPagesError(error)

          assert.match(generatedError.message, /Output path conflict/)
          assert.match(generatedError.message, /pages file: "conflict\.pages\.js"/)
          assert.equal(generatedError.code, 'DOM_STACK_ERROR_OUTPUT_CONFLICT')
          assert.deepEqual(generatedError.conflict, {
            outputPath: 'index.html',
            a: { type: 'page', path: 'README.md' },
            b: { type: 'page', path: 'conflict.pages.js#0' },
          })
          assert.equal(generatedError.pagesFile?.pagesFile.relname, 'conflict.pages.js')
          return true
        }
      )
    })
  })

  test('throws a conflict error with both generated page sources', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'first.pages.js': "export default { outputName: 'shared/index.html' }\n",
      'second.pages.js': "export default { outputName: 'shared/index.html' }\n",
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      await assert.rejects(
        () => domstack.build(),
        error => {
          const generatedError = firstGeneratedPagesError(error)
          const conflictingSources = [
            generatedError.conflict?.a.path,
            generatedError.conflict?.b.path,
          ].sort()

          assert.equal(generatedError.code, 'DOM_STACK_ERROR_OUTPUT_CONFLICT')
          assert.equal(generatedError.conflict?.outputPath, 'shared/index.html')
          assert.deepEqual(conflictingSources, ['first.pages.js#0', 'second.pages.js#0'])
          assert.equal(`${generatedError.pagesFile?.pagesFile.relname}#0`, generatedError.conflict?.b.path)
          return true
        }
      )
    })
  })

  test('rejects invalid definitions returned in arrays', async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'invalid.pages.js': 'export default [{ outputName: "valid/index.html" }, 42]\n',
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      await assert.rejects(
        () => domstack.build(),
        error => {
          const generatedError = firstGeneratedPagesError(error)

          assert.match(generatedError.message, /Generated page definition must be an object/)
          assert.match(generatedError.message, /pages file: "invalid\.pages\.js"/)
          assert.equal(generatedError.name, 'TypeError')
          assert.equal(generatedError.pagesFile?.pagesFile.relname, 'invalid.pages.js')
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
          const generatedError = firstGeneratedPagesError(error)

          assert.match(generatedError.message, /must not contain "\.\." segments/)
          assert.match(generatedError.message, /pages file: "invalid\.pages\.js"/)
          assert.equal(generatedError.pagesFile?.pagesFile.relname, 'invalid.pages.js')
          return true
        }
      )
    })
  })

  test('rejects generated output names that do not name a file', async () => {
    for (const outputName of ['.', './', 'nested/']) {
      await withTempFixture({
        'root.layout.js': minimalRootLayout,
        'global.vars.js': minimalGlobalVars,
        'invalid.pages.js': `export default { outputName: ${JSON.stringify(outputName)}, children: 'invalid' }\n`,
      }, async ({ src, dest }) => {
        const domstack = new DomStack(src, dest)
        await assert.rejects(
          () => domstack.build(),
          error => {
            const generatedError = firstGeneratedPagesError(error)

            assert.match(generatedError.message, /must not be empty|must name a file/)
            assert.match(generatedError.message, /pages file: "invalid\.pages\.js"/)
            return true
          }
        )
      })
    }
  })

  test('rebuilds a generated-pages owner when an observed page var changes', { timeout: 15_000 }, async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'page.js': 'export default ({ vars }) => vars.title\n',
      'page.vars.js': "export default { title: 'First title' }\n",
      'watch-indexes.pages.js': `export default function ({ pages }) {
  const title = pages[0].vars.title
  const outputName = title === 'First title'
    ? 'watch-first/index.html'
    : 'watch-updated/index.html'
  return { outputName, children: () => title }
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      try {
        await domstack.watch({ serve: false })
        const initialOutputPath = join(dest, 'watch-first/index.html')
        const updatedOutputPath = join(dest, 'watch-updated/index.html')
        assert.match(await readFile(initialOutputPath, 'utf8'), /First title/)

        await writeFile(join(src, 'page.vars.js'), "export default { title: 'Updated title' }\n")
        await new Promise(resolve => setTimeout(resolve, 800))
        await domstack.settled()

        const updatedOutput = await readFile(updatedOutputPath, 'utf8')
        assert.match(updatedOutput, /Updated title/)
        assert.doesNotMatch(updatedOutput, /First title/)
        await assert.rejects(() => stat(initialOutputPath), 'obsolete dependency-driven output is removed')
      } finally {
        if (domstack.watching) await domstack.stopWatching()
      }
    })
  })

  test('rebuilds generated pages when Markdown settings change in watch mode', { timeout: 15_000 }, async () => {
    const markdownSettings = (/** @type {string} */ version) => `export default function (md) {
  md.renderer.rules.paragraph_open = () => '<p data-version="${version}">'
  return md
}
`

    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'post.md': 'Rendered post\n',
      'markdown-it.settings.js': markdownSettings('first'),
      'markdown-summary.pages.js': `export default async function ({ pages }) {
  const post = pages.find(page => page.pageInfo.pageFile.relname === 'post.md')
  if (!post) throw new Error('Missing Markdown post')
  const children = await post.renderInnerPage({ pages })
  return { outputName: 'summary/index.html', children }
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      const outputPath = join(dest, 'summary/index.html')

      try {
        await domstack.watch({ serve: false })
        assert.match(await readFile(outputPath, 'utf8'), /data-version="first"/)

        await writeFile(join(src, 'markdown-it.settings.js'), markdownSettings('second'))
        await new Promise(resolve => setTimeout(resolve, 800))
        await domstack.settled()

        const updatedOutput = await readFile(outputPath, 'utf8')
        assert.match(updatedOutput, /data-version="second"/)
        assert.doesNotMatch(updatedOutput, /data-version="first"/)
      } finally {
        if (domstack.watching) await domstack.stopWatching()
      }
    })
  })

  test('rebuilds generated pages when layout assets are added or removed in watch mode', { timeout: 25_000 }, async () => {
    await withTempFixture({
      'root.layout.js': assetAwareRootLayout,
      'global.vars.js': minimalGlobalVars,
      'page.js': "export default () => 'Regular page'\n",
      'layout-assets.pages.js': `export default {
  outputName: 'generated/index.html',
  children: 'Generated page',
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      const regularOutputPath = join(dest, 'index.html')
      const generatedOutputPath = join(dest, 'generated/index.html')

      const waitForRebuild = async () => {
        await new Promise(resolve => setTimeout(resolve, 800))
        await domstack.settled()
      }

      /**
       * @param {string} assetName
       * @param {boolean} expected
       */
      const assertAssetReference = async (assetName, expected) => {
        const [regularHtml, generatedHtml] = await Promise.all([
          readFile(regularOutputPath, 'utf8'),
          readFile(generatedOutputPath, 'utf8'),
        ])
        assert.equal(regularHtml.includes(assetName), expected, `regular page ${expected ? 'includes' : 'omits'} ${assetName}`)
        assert.equal(generatedHtml.includes(assetName), expected, `generated page ${expected ? 'includes' : 'omits'} ${assetName}`)
      }

      try {
        await domstack.watch({ serve: false })
        await assertAssetReference('root.layout.css', false)
        await assertAssetReference('root.layout.client.js', false)

        await writeFile(join(src, 'root.layout.css'), 'body { color: red }\n')
        await waitForRebuild()
        await assertAssetReference('root.layout.css', true)

        await rm(join(src, 'root.layout.css'))
        await waitForRebuild()
        await assertAssetReference('root.layout.css', false)

        await writeFile(join(src, 'root.layout.client.js'), 'globalThis.layoutClientLoaded = true\n')
        await waitForRebuild()
        await assertAssetReference('root.layout.client.js', true)

        await rm(join(src, 'root.layout.client.js'))
        await waitForRebuild()
        await assertAssetReference('root.layout.client.js', false)
      } finally {
        if (domstack.watching) await domstack.stopWatching()
      }
    })
  })

  test('removes obsolete regular and generated page outputs in watch mode', { timeout: 20_000 }, async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'regular/page.html': '<p>Regular page</p>',
      'changing.pages.js': `export default [
  { outputName: 'old/index.html', children: 'Old generated page' },
  { outputName: 'removed/index.html', children: 'Removed generated page' },
  { outputName: 'drafted/index.html', children: 'Published generated page' },
]
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      try {
        await domstack.watch({ serve: false })
        const oldOutputPath = join(dest, 'old/index.html')
        const newOutputPath = join(dest, 'new/index.html')
        const removedOutputPath = join(dest, 'removed/index.html')
        const draftedOutputPath = join(dest, 'drafted/index.html')
        const regularOutputPath = join(dest, 'regular/index.html')

        assert.match(await readFile(oldOutputPath, 'utf8'), /Old generated page/)
        assert.match(await readFile(removedOutputPath, 'utf8'), /Removed generated page/)
        assert.match(await readFile(draftedOutputPath, 'utf8'), /Published generated page/)
        assert.match(await readFile(regularOutputPath, 'utf8'), /Regular page/)

        await writeFile(join(src, 'changing.pages.js'), `export default [
  { outputName: 'new/index.html', children: 'Renamed generated page' },
  { outputName: 'drafted/index.html', children: 'Draft generated page', draft: true },
]
`)
        await new Promise(resolve => setTimeout(resolve, 800))
        await domstack.settled()

        assert.match(await readFile(newOutputPath, 'utf8'), /Renamed generated page/)
        await assert.rejects(() => readFile(oldOutputPath, 'utf8'), { code: 'ENOENT' })
        await assert.rejects(() => readFile(removedOutputPath, 'utf8'), { code: 'ENOENT' })
        await assert.rejects(() => readFile(draftedOutputPath, 'utf8'), { code: 'ENOENT' })

        await rm(join(src, 'regular/page.html'))
        await new Promise(resolve => setTimeout(resolve, 800))
        await domstack.settled()
        await assert.rejects(() => readFile(regularOutputPath, 'utf8'), { code: 'ENOENT' })

        await rm(join(src, 'changing.pages.js'))
        await new Promise(resolve => setTimeout(resolve, 800))
        await domstack.settled()
        await assert.rejects(() => readFile(newOutputPath, 'utf8'), { code: 'ENOENT' })
      } finally {
        if (domstack.watching) await domstack.stopWatching()
      }
    })
  })

  test('refreshes pages-file dependency trees in watch mode', { timeout: 15_000 }, async () => {
    await withTempFixture({
      'root.layout.js': minimalRootLayout,
      'global.vars.js': minimalGlobalVars,
      'generated-value.js': "export const value = 'First value'\n",
      'watched.pages.js': `export default {
  outputName: 'watched/index.html',
  children: 'Initial value',
}
`,
    }, async ({ src, dest }) => {
      const domstack = new DomStack(src, dest)
      try {
        await domstack.watch({ serve: false })
        const outputPath = join(dest, 'watched/index.html')
        assert.match(await readFile(outputPath, 'utf8'), /Initial value/)

        await writeFile(join(src, 'watched.pages.js'), `import { value } from './generated-value.js'

export default {
  outputName: 'watched/index.html',
  children: value + ' after pages edit',
}
`)
        await new Promise(resolve => setTimeout(resolve, 800))
        await domstack.settled()
        assert.match(await readFile(outputPath, 'utf8'), /First value after pages edit/)

        await writeFile(join(src, 'generated-value.js'), "export const value = 'Updated dependency'\n")
        await new Promise(resolve => setTimeout(resolve, 800))
        await domstack.settled()
        assert.match(await readFile(outputPath, 'utf8'), /Updated dependency after pages edit/)
      } finally {
        if (domstack.watching) await domstack.stopWatching()
      }
    })
  })
})
