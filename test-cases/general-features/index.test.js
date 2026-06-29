/**
 * @import { DomstackManifestEntry } from '#types'
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { DOMSTACK_MANIFEST_SCHEMA_ID, DomStack, buildDomstackManifest, testBuild } from '../../index.js'
import * as path from 'path'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import * as cheerio from 'cheerio'
import { allFiles } from 'async-folder-walker'

const __dirname = import.meta.dirname

test.describe('general-features', () => {
  test('should build site with all features', async (t) => {
    const src = path.join(__dirname, './src')
    const build = await testBuild(src, { copy: [path.join(__dirname, './copyfolder')] })
    const { dest, results } = build

    t.after(async () => {
      await build.cleanup()
    })

    assert.ok(results, 'DomStack built site and returned build results')
    assert.ok(results.domstackManifest, 'build returned a domstack manifest')
    assert.strictEqual(
      results.domstackManifest.$schema,
      DOMSTACK_MANIFEST_SCHEMA_ID,
      'domstack manifest includes its schema URL'
    )

    const domstackManifestPath = path.join(dest, 'domstack-manifest.json')
    /** @type {{ $schema: string, version: string, entries: Record<string, unknown>[] }} */
    const writtenDomstackManifest = JSON.parse(await readFile(domstackManifestPath, 'utf8'))
    assert.strictEqual(
      writtenDomstackManifest.$schema,
      results.domstackManifest.$schema,
      'written domstack manifest schema URL matches returned domstack manifest'
    )
    assert.strictEqual(
      writtenDomstackManifest.version,
      results.domstackManifest.version,
      'written domstack manifest matches returned domstack manifest'
    )
    assert.ok(
      writtenDomstackManifest.entries.every(entry => !('filepath' in entry)),
      'written domstack manifest does not expose absolute filesystem paths'
    )

    const manifestEntries = /** @type {DomstackManifestEntry[]} */ (results.domstackManifest.entries)
    const manifestEntryByUrl = new Map(manifestEntries.map(entry => [entry.url, entry]))

    assert.ok(manifestEntryByUrl.has('/'), 'domstack manifest includes root page URL')
    assert.ok(manifestEntryByUrl.has('/md-page/'), 'domstack manifest includes nested page URL')
    assert.ok(manifestEntryByUrl.has('/md-page/loose-md.html'), 'domstack manifest includes loose markdown URL')
    assert.ok(manifestEntryByUrl.has('/feeds/feed.json'), 'domstack manifest includes normal template output')
    assert.ok(manifestEntryByUrl.has('/worker-page/workers.json'), 'domstack manifest includes worker manifest')
    assert.ok(
      !manifestEntryByUrl.has('/domstack-manifest.json'),
      'domstack manifest does not include itself'
    )

    const serviceWorkerEntry = manifestEntryByUrl.get('/service-worker.js')
    assert.equal(serviceWorkerEntry?.kind, 'service-worker', 'domstack manifest classifies the site service worker')
    assert.equal(
      serviceWorkerEntry?.sourceRelname,
      'globals/service-worker.mts',
      'domstack manifest records the service worker source file'
    )

    assert.ok(
      manifestEntries.some(entry => entry.kind === 'chunk' && entry.url.startsWith('/chunks/js/chunk-')),
      'domstack manifest classifies shared JS chunks'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'sourcemap' && entry.url.endsWith('.map')),
      'domstack manifest classifies source maps'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'worker' && entry.url.includes('/worker-page/counter.worker-')),
      'domstack manifest classifies worker bundles'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'copy' && entry.url === '/oldsite/client.js'),
      'domstack manifest includes copy directory outputs'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'static' && entry.url === '/static.json'),
      'domstack manifest includes static outputs'
    )
    assert.deepStrictEqual(
      manifestEntryByUrl.get('/js-page/')?.page?.vars,
      { precache: false, offline: false },
      'domstack manifest includes page-level precache/offline vars'
    )

    for (const entry of manifestEntries) {
      assert.ok(entry.url.startsWith('/'), `${entry.outputRelname} has an absolute URL`)
      assert.ok(entry.revision, `${entry.outputRelname} has a content revision`)
      assert.ok(Number.isInteger(entry.bytes), `${entry.outputRelname} has byte size`)
    }

    const serviceWorkerContent = await readFile(path.join(dest, 'service-worker.js'), 'utf8')
    assert.ok(serviceWorkerContent.includes('/domstack-manifest.json'), 'service worker was bundled')
    assert.ok(!serviceWorkerContent.includes('process.env.DOMSTACK_MANIFEST_URL'), 'service worker receives the domstack manifest URL define')
    assert.ok(!serviceWorkerContent.includes('process.env.DOMSTACK_MANIFEST_ENABLED'), 'service worker receives the domstack manifest enabled define')
    assert.ok(serviceWorkerContent.includes('cache: "no-store"'), 'service worker fetches the domstack manifest at runtime')
    assert.ok(serviceWorkerContent.includes('caches.match(request)'), 'service worker has cache-first fetch handling')

    const metaContent = await readFile(path.join(dest, 'domstack-esbuild-meta.json'), 'utf8')
    const metaData = JSON.parse(metaContent)
    assert.ok(
      Object.keys(metaData.outputs).some(outputPath => outputPath.endsWith('/service-worker.js')),
      'esbuild metafile includes the service worker output'
    )

    const stableSite = new DomStack(src, dest, { copy: [path.join(__dirname, './copyfolder')] })
    const stableResults = await stableSite.build()

    assert.strictEqual(
      stableResults.domstackManifest?.version,
      results.domstackManifest.version,
      'domstack manifest version is stable across identical builds'
    )

    await t.test('domstackManifest version includes cache-relevant metadata', async () => {
      const basePage = {
        path: '',
        url: '/',
        vars: {
          precache: true,
          offline: true,
        },
      }
      /** @type {DomstackManifestEntry} */
      const baseEntry = {
        outputRelname: 'index.html',
        kind: 'page',
        url: '/',
        revision: 'same-file-revision',
        bytes: 42,
        sourceRelname: 'pages/index.js',
        page: basePage,
      }

      const baseManifest = await buildDomstackManifest({ dest, entries: [baseEntry] })
      const sourceOnlyManifest = await buildDomstackManifest({
        dest,
        entries: [{
          ...baseEntry,
          sourceRelname: 'pages/renamed-index.js',
        }],
      })
      const kindChangedManifest = await buildDomstackManifest({
        dest,
        entries: [{
          ...baseEntry,
          kind: 'template',
        }],
      })
      const offlineChangedManifest = await buildDomstackManifest({
        dest,
        entries: [{
          ...baseEntry,
          page: {
            ...basePage,
            vars: {
              ...basePage.vars,
              offline: false,
            },
          },
        }],
      })
      const objectPrecacheManifest = await buildDomstackManifest({
        dest,
        entries: [{
          ...baseEntry,
          page: {
            ...basePage,
            vars: {
              ...basePage.vars,
              precache: { core: true, priority: 1 },
            },
          },
        }],
      })
      const reorderedObjectPrecacheManifest = await buildDomstackManifest({
        dest,
        entries: [{
          ...baseEntry,
          page: {
            ...basePage,
            vars: {
              ...basePage.vars,
              precache: { priority: 1, core: true },
            },
          },
        }],
      })

      assert.strictEqual(
        sourceOnlyManifest.version,
        baseManifest.version,
        'source metadata does not affect domstack manifest version'
      )
      assert.notStrictEqual(
        kindChangedManifest.version,
        baseManifest.version,
        'kind affects domstack manifest version'
      )
      assert.notStrictEqual(
        offlineChangedManifest.version,
        baseManifest.version,
        'page offline policy affects domstack manifest version'
      )
      assert.strictEqual(
        reorderedObjectPrecacheManifest.version,
        objectPrecacheManifest.version,
        'object-valued page cache policy uses stable key ordering'
      )
    })

    await t.test('domstackManifest exclude handles root page URL', async () => {
      const excludeBuild = await testBuild(src, {
        copy: [path.join(__dirname, './copyfolder')],
        domstackManifest: {
          exclude: ['oldsite/**'],
        },
      })
      t.after(async () => {
        await excludeBuild.cleanup()
      })

      const excludeEntries = /** @type {DomstackManifestEntry[]} */ (excludeBuild.results.domstackManifest?.entries ?? [])

      assert.ok(
        excludeEntries.some(entry => entry.url === '/'),
        'root page URL survives non-root exclude filters'
      )
      assert.ok(
        !excludeEntries.some(entry => entry.url.startsWith('/oldsite/')),
        'exclude filters still remove matching output paths'
      )
    })

    await t.test('domstack-manifest.settings.js filters domstack manifest entries', async (t) => {
      const settingsSrc = await mkdtemp(path.join(tmpdir(), 'domstack-manifest-settings-'))
      const settingsDest = await mkdtemp(path.join(tmpdir(), 'domstack-manifest-settings-public-'))
      t.after(async () => {
        await rm(settingsSrc, { recursive: true, force: true })
        await rm(settingsDest, { recursive: true, force: true })
      })

      await mkdir(path.join(settingsSrc, 'kept'), { recursive: true })
      await mkdir(path.join(settingsSrc, 'programmatic'), { recursive: true })
      await mkdir(path.join(settingsSrc, 'settings'), { recursive: true })
      await writeFile(path.join(settingsSrc, 'page.js'), 'export default () => "<p>Domstack manifest settings</p>"\n')
      await writeFile(path.join(settingsSrc, 'kept/page.js'), 'export default () => "<p>Kept</p>"\n')
      await writeFile(path.join(settingsSrc, 'programmatic/page.js'), 'export default () => "<p>Programmatic exclude</p>"\n')
      await writeFile(path.join(settingsSrc, 'settings/page.js'), 'export default () => "<p>Settings exclude</p>"\n')
      await writeFile(path.join(settingsSrc, 'domstack-manifest.settings.js'), `
export default async function domstackManifestSettings () {
  return {
    exclude: ['settings/**'],
    includeEntry (entry) {
      return entry.kind !== 'sourcemap'
    },
  }
}
`)

      const settingsSite = new DomStack(settingsSrc, settingsDest, {
        domstackManifest: {
          exclude: ['programmatic/**'],
        },
      })

      const settingsResults = await settingsSite.build()
      const settingsEntries = /** @type {DomstackManifestEntry[]} */ (settingsResults.domstackManifest?.entries ?? [])

      assert.ok(
        settingsEntries.some(entry => entry.url === '/'),
        'root page survives domstack manifest settings filters'
      )
      assert.ok(
        settingsEntries.some(entry => entry.url === '/kept/'),
        'unfiltered page output remains in manifest'
      )
      assert.ok(
        !settingsEntries.some(entry => entry.url === '/programmatic/'),
        'programmatic domstackManifest exclude is applied'
      )
      assert.ok(
        !settingsEntries.some(entry => entry.url === '/settings/'),
        'domstack-manifest.settings.js exclude is applied'
      )
      assert.ok(
        !settingsEntries.some(entry => entry.kind === 'sourcemap'),
        'domstack-manifest.settings.js includeEntry is applied'
      )
    })

    await t.test('metafile false skips esbuild metadata without breaking domstack manifest', async () => {
      const noMetaBuild = await testBuild(src, {
        copy: [path.join(__dirname, './copyfolder')],
        metafile: false,
      })
      t.after(async () => {
        await noMetaBuild.cleanup()
      })

      const noMetaDest = noMetaBuild.dest
      const noMetaResults = noMetaBuild.results
      const noMetaEntries = /** @type {DomstackManifestEntry[]} */ (noMetaResults.domstackManifest?.entries ?? [])

      assert.ok(noMetaResults.domstackManifest, 'build returned a domstack manifest with metafile disabled')
      assert.ok(
        noMetaEntries.some(entry => entry.kind === 'script'),
        'domstack manifest still includes esbuild script outputs'
      )
      assert.ok(
        noMetaEntries.some(entry => entry.kind === 'sourcemap'),
        'domstack manifest still includes esbuild sourcemap outputs'
      )
      assert.ok(
        !noMetaEntries.some(entry => entry.kind === 'metadata' && entry.url === '/domstack-esbuild-meta.json'),
        'domstack manifest does not include skipped esbuild metafile'
      )
      await assert.rejects(
        () => stat(path.join(noMetaDest, 'domstack-esbuild-meta.json')),
        'esbuild metafile was not written'
      )
    })

    await t.test('service worker define follows nested custom domstackManifest filename', async () => {
      const customManifestBuild = await testBuild(src, {
        domstackManifest: {
          filename: 'metadata/domstack-manifest.json',
        },
      })
      t.after(async () => {
        await customManifestBuild.cleanup()
      })

      const customManifestDest = customManifestBuild.dest
      const customServiceWorkerContent = await readFile(path.join(customManifestDest, 'service-worker.js'), 'utf8')

      await stat(path.join(customManifestDest, 'metadata/domstack-manifest.json'))
      await assert.rejects(
        () => stat(path.join(customManifestDest, 'domstack-manifest.json')),
        'default domstack manifest filename was not written'
      )
      assert.ok(
        customServiceWorkerContent.includes('/metadata/domstack-manifest.json'),
        'service worker receives the nested custom domstack manifest URL define'
      )
    })

    await t.test('esbuild settings cannot drop reserved DOMSTACK defines', async (t) => {
      const defineSrc = await mkdtemp(path.join(tmpdir(), 'domstack-esbuild-defines-'))
      t.after(async () => {
        await rm(defineSrc, { recursive: true, force: true })
      })

      await writeFile(path.join(defineSrc, 'page.js'), 'export default () => "<p>DOMSTACK defines</p>"\n')
      await writeFile(path.join(defineSrc, 'global.client.js'), `
console.log(
  process.env.DOMSTACK_MANIFEST_URL,
  process.env.DOMSTACK_SERVICE_WORKER_URL,
  process.env.CUSTOM_DEFINE
)
`)
      await writeFile(path.join(defineSrc, 'service-worker.js'), `
console.log(
  process.env.DOMSTACK_MANIFEST_URL,
  process.env.DOMSTACK_SERVICE_WORKER_SCOPE,
  process.env.CUSTOM_DEFINE
)
`)
      await writeFile(path.join(defineSrc, 'esbuild.settings.js'), `
export default function esbuildSettings (opts) {
  return {
    ...opts,
    define: {
      'process.env.CUSTOM_DEFINE': JSON.stringify('from-settings'),
    },
  }
}
`)

      const defineBuild = await testBuild(defineSrc)
      t.after(async () => {
        await defineBuild.cleanup()
      })

      const defineFiles = await allFiles(defineBuild.dest, { shaper: fwData => fwData })
      const globalClientFile = defineFiles.find(file => file.relname.match(/global\.client-.+\.js$/))
      assert.ok(globalClientFile, 'global client bundle was written')

      const globalClientContent = await readFile(path.join(defineBuild.dest, globalClientFile.relname), 'utf8')
      const defineServiceWorkerContent = await readFile(path.join(defineBuild.dest, 'service-worker.js'), 'utf8')

      assert.ok(globalClientContent.includes('/domstack-manifest.json'), 'global client keeps domstack manifest URL define')
      assert.ok(globalClientContent.includes('/service-worker.js'), 'global client keeps service worker URL define')
      assert.ok(globalClientContent.includes('from-settings'), 'global client keeps user esbuild define')
      assert.ok(!globalClientContent.includes('process.env.DOMSTACK_'), 'global client has no unreplaced DOMSTACK defines')
      assert.ok(defineServiceWorkerContent.includes('/domstack-manifest.json'), 'service worker keeps domstack manifest URL define')
      assert.match(defineServiceWorkerContent, /["']\/["']/, 'service worker keeps service worker scope define')
      assert.ok(defineServiceWorkerContent.includes('from-settings'), 'service worker keeps user esbuild define')
      assert.ok(!defineServiceWorkerContent.includes('process.env.DOMSTACK_'), 'service worker has no unreplaced DOMSTACK defines')
    })

    await t.test('esbuild settings cannot override reserved DOMSTACK defines', async (t) => {
      const conflictSrc = await mkdtemp(path.join(tmpdir(), 'domstack-esbuild-define-conflict-'))
      const conflictDest = await mkdtemp(path.join(tmpdir(), 'domstack-esbuild-define-conflict-public-'))
      t.after(async () => {
        await rm(conflictSrc, { recursive: true, force: true })
        await rm(conflictDest, { recursive: true, force: true })
      })

      await writeFile(path.join(conflictSrc, 'page.js'), 'export default () => "<p>DOMSTACK define conflict</p>"\n')
      await writeFile(path.join(conflictSrc, 'global.client.js'), 'console.log(process.env.DOMSTACK_MANIFEST_URL)\n')
      await writeFile(path.join(conflictSrc, 'esbuild.settings.js'), `
export default function esbuildSettings (opts) {
  return {
    ...opts,
    define: {
      ...opts.define,
      'process.env.DOMSTACK_MANIFEST_URL': JSON.stringify('/not-domstack-owned.json'),
    },
  }
}
`)

      await assert.rejects(
        () => new DomStack(conflictSrc, conflictDest).build(),
        error => {
          if (!(error instanceof Error)) return false
          const buildError = /** @type {Error & { errors?: Array<Error & { cause?: unknown }> }} */ (error)
          return error.message.includes('Prebuild finished but there were errors') &&
            buildError.errors?.some(err => {
              const cause = err.cause
              return err.message.includes('Error building JS+CSS with esbuild') &&
                cause instanceof Error &&
                cause.message.includes('process.env.DOMSTACK_MANIFEST_URL') &&
                cause.message.includes('reserved by domstack')
            }) === true
        },
        'reserved DOMSTACK define conflicts fail clearly'
      )
    })

    const globalAssets = {
      globalStyle: true,
      globalClient: true,
    }

    const pages = {
      'index.html': {
        client: true,
        style: true,
      },
      'md-page/index.html': {
        client: true,
        style: true,
      },
      'md-page/loose-md.html': {
        client: false,
        style: false,
      },
      'md-page/markdown-settings-test.html': {
        client: false,
        style: false
      },
      'md-page/md-no-style-client/index.html': {
        client: false,
        style: false,
      },
      'js-page/index.html': {
        client: true,
        style: true,
      },
      'js-page/loose-md.html': {
        client: false,
        style: false,
      },
      'js-page/js-no-style-client/index.html': {
        client: false,
        style: false,
      },
      'js-page/js-no-async-export/index.html': {
        client: false,
        style: false,
      },
      'html-page/index.html': {
        client: true,
        style: true,
      },
      'html-page/html-no-style-client/index.html': {
        client: false,
        style: false,
      },
      'worker-page/index.html': {
        client: true,
        style: true,
        worker: true
      },
      'page-md-page/index.html': {
        client: false,
        style: false,
      },
      'page-md-precedence/index.html': {
        client: false,
        style: false,
      },
    }

    const files = await allFiles(dest, { shaper: fwData => fwData })

    assert.ok(true, 'All files walked in output')

    const generatedGlobalStyle = files.some(f => f.relname.match(/global-([A-Z0-9])\w+.css/g))
    assert.equal(generatedGlobalStyle, globalAssets.globalStyle, `${globalAssets.globalStyle
            ? 'Generated'
            : 'Did not generate'} a global style`)

    const generatedGlobalClient = files.some(f => f.relname.match(/global.client-([A-Z0-9])\w+.js/g))
    assert.equal(generatedGlobalClient, globalAssets.globalClient, `${globalAssets.globalClient
            ? 'Generated'
            : 'Did not generate'} a global client`)

    // Shared chunks (html-page, js-page, and md-page/client.js all import client-helper.js)
    // must be emitted with a hash in their filename to avoid output path collisions.
    const jsChunkFiles = files.filter(f => f.relname.match(/chunks\/js\/chunk-.+\.js$/))
    assert.ok(jsChunkFiles.length > 0, 'at least one shared JS chunk was produced with a hashed name')

    // Verify that global.data.js output reaches template vars
    const feedJsonPath = path.join(dest, 'feeds/feed.json')
    try {
      const feedContent = await readFile(feedJsonPath, 'utf8')
      const feedData = JSON.parse(feedContent)
      assert.strictEqual(
        feedData._globalDataSentinel,
        'data-from-global-dot-data',
        'feeds template received globalDataSentinel from global.data.js via vars'
      )
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error', { cause: err })
      assert.fail('Failed to verify global.data.js output in template vars: ' + error.message)
    }

    // Verify that CSS asset loaders work: images inline as data URLs, fonts are emitted as files
    const globalCssFile = files.find(f => f.relname.match(/global-([A-Z0-9])\w+\.css$/))
    if (globalCssFile) {
      const cssContent = await readFile(path.join(dest, globalCssFile.relname), 'utf8')
      assert.ok(
        cssContent.includes('data:image/gif;base64,'),
        'global CSS inlines GIF image as a base64 data URL'
      )
    } else {
      assert.fail('Could not find global CSS output file to verify asset loaders')
    }

    const woff2Files = files.filter(f => f.relname.endsWith('.woff2'))
    assert.ok(woff2Files.length > 0, 'woff2 font file was emitted to the output directory')
    // Special test for global.data.js blogPostsHtml
    const indexPath = path.join(dest, 'index.html')
    try {
      const indexContent = await readFile(indexPath, 'utf8')
      const indexDoc = cheerio.load(indexContent)
      const blogIndexList = indexDoc('ul.blog-index-list')
      assert.ok(blogIndexList.length > 0, 'global.data.js rendered blog-index-list into the root page')
      const blogEntries = indexDoc('li.blog-entry')
      assert.ok(blogEntries.length > 0, 'global.data.js blog list contains entries')
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error', { cause: err })
      assert.fail('Failed to verify global.data.js output: ' + error.message)
    }

    // Special test for page.md precedence over README.md
    const pageMdPrecedencePath = path.join(dest, 'page-md-precedence/index.html')
    try {
      const pageMdContent = await readFile(pageMdPrecedencePath, 'utf8')
      assert.ok(pageMdContent.includes('from page.md'), 'page.md content is rendered')
      assert.ok(!pageMdContent.includes('from README.md'), 'README.md content is not rendered when page.md exists')
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error', { cause: err })
      assert.fail('Failed to verify page.md precedence: ' + error.message)
    }

    // Special test for markdown-it.settings.js
    const mdSettingsTestPath = path.join(dest, 'md-page/markdown-settings-test.html')
    try {
      const mdTestContent = await readFile(mdSettingsTestPath, 'utf8')
      const mdTestDoc = cheerio.load(mdTestContent)

      // Check if our custom test-box container exists - this proves markdown-it.settings.js worked
      const testBox = mdTestDoc('.test-box')
      assert.ok(testBox.length > 0, 'markdown-it.settings.js was applied - custom container found')
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error', { cause: err })
      assert.fail('Failed to verify markdown-it.settings.js customization: ' + error.message)
    }

    // Check for worker files existence (used in the next test)
    const hasWorkerFiles = files.some(f => f.relname.includes('worker-page') && f.relname.includes('counter.worker-'))
    assert.ok(hasWorkerFiles, 'Worker files exist in the output')

    // Test for web worker functionality
    await t.test('should support web workers', async () => {
      // Check for worker files in the output
      const workerFiles = files.filter(f => f.relname.includes('counter.worker-'))
      assert.ok(workerFiles.length > 0, 'Web worker files were bundled')

      // Check that the metafile contains worker entries
      const metaFilePath = path.join(dest, 'domstack-esbuild-meta.json')
      const metaContent = await readFile(metaFilePath, 'utf8')
      const metaData = JSON.parse(metaContent)

      // Verify worker files in the outputs section of the metafile
      let workerOutputFound = false
      for (const outputPath of Object.keys(metaData.outputs)) {
        if (outputPath.includes('counter.worker-')) {
          workerOutputFound = true
          break
        }
      }
      assert.ok(workerOutputFound, 'Worker output found in metafile')

      // Check the worker page HTML content
      const workerPagePath = path.join(dest, 'worker-page/index.html')
      const workerContent = await readFile(workerPagePath, 'utf8')
      const workerDoc = cheerio.load(workerContent)

      // Verify the counter display element exists
      const counterElement = workerDoc('#counter')
      assert.ok(counterElement.length > 0, 'Counter element exists in worker page')

      // Verify the worker page has client.js that uses the worker
      const clientScripts = workerDoc('script[type="module"]')
      assert.ok(clientScripts.length > 0, 'Client scripts exist in worker page')

      let hasClientScript = false
      clientScripts.each((_, script) => {
        const src = workerDoc(script).attr('src')
        if (src && src.includes('client-')) {
          hasClientScript = true
        }
      })
      assert.ok(hasClientScript, 'Client script with worker initialization is included')
    })

    for (const [filePath, assertions] of Object.entries(pages)) {
      try {
        const fullPath = path.join(dest, filePath)
        const st = await stat(fullPath)
        assert.ok(st, `${filePath} exists`)

        const contents = await readFile(fullPath, 'utf8')
        const doc = cheerio.load(contents)

        const headScripts = Array.from(doc('head script[type="module"]'))

        const hasGlboalClientHeader = headScripts.map(n => n?.attribs?.['src'])?.some(src => src && src.match(/global.client-([A-Z0-9])\w+.js/g))
        const hasPageClientHeader = headScripts.map(n => n?.attribs?.['src']).some(src => src && src.match(/\.\/client-([A-Z0-9])\w+.js/g))
        const generatedPageClient = files.some(f => f.relname.match(/client-([A-Z0-9])\w+.js/g))

        const headLinks = Array.from(doc('head link[rel="stylesheet"]'))
        const hasGlobalStyleHeader = headLinks.map(n => n?.attribs?.['href']).some(href => href && href.match(/global-([A-Z0-9])\w+.css/g))
        const hasPageStyleHeader = headLinks.map(n => n?.attribs?.['href']).some(href => href && href.match(/\.\/style-([A-Z0-9])\w+.css/g))
        const generatedPageStyle = files.some(f => f.relname.match(/style-([A-Z0-9])\w+.css/g))

        const wroteDomstackEsbuildMetaFile = files.find(f => f.relname.match(/domstack-esbuild-meta.json/g))

        assert.equal(
          hasGlboalClientHeader,
          globalAssets.globalClient,
                    `${filePath} ${globalAssets.globalClient
                        ? 'includes'
                        : 'does not include'} a global client header`)

        assert.equal(
          hasGlobalStyleHeader,
          globalAssets.globalStyle,
                    `${filePath} ${globalAssets.globalStyle
                        ? 'Includes'
                        : 'Does not include'} a global style header`)

        assert.equal(
          hasPageClientHeader,
          assertions.client,
                    `${filePath} ${assertions.client
                        ? 'Includes'
                        : 'Does not include'} a page client header`)

        if (hasPageClientHeader) { // covering for loose files
          assert.equal(
            generatedPageClient,
            assertions.client,
                        `${filePath} ${assertions.client
                            ? 'Generated'
                            : 'Did not generate'} a page client file`)
        }

        assert.equal(
          hasPageStyleHeader,
          assertions.style,
                    `${filePath} ${assertions.client
                        ? 'Includes'
                        : 'Does not include'} a page style header`)

        assert.ok(
          wroteDomstackEsbuildMetaFile,
          'wrote out the domstack-esbuild-meta.json file'
        )

        if (hasPageStyleHeader) { // covering for loose files
          assert.equal(
            generatedPageStyle,
            assertions.style,
                        `${filePath} ${assertions.client
                            ? 'Generated'
                            : 'Did not generate'} a page style file`)
        }
      } catch (e) {
        console.error(e)
        assert.fail(`Assertions failed on ${filePath}`)
      }
    }

    const expected = [
      'client.js',
      'hello.html',
      'styles/globals.css'
    ]

    for (const rel of expected) {
      const full = path.join(dest, 'oldsite', rel)
      const st = await stat(full)
      assert.ok(st.isFile(), `oldsite/${rel} exists and is a file`)
    }
  })
})
