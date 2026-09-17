/**
 * @import { DomstackManifestEntry } from '#types'
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { DOMSTACK_MANIFEST_SCHEMA_ID, DomStack, testBuild } from '../../index.js'
import * as path from 'path'
import { readFile, stat } from 'fs/promises'
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
    assert.ok(results.esbuildResults.outputs.length > 0, 'esbuild exposes manifest outputs at the build-step level')
    assert.ok(results.esbuildResults.report.buildResults, 'esbuild retains its detailed build report')
    assert.ok(results.esbuildResults.report.buildOpts, 'esbuild reports its resolved build options')
    assert.ok(results.esbuildResults.report.outputMap, 'esbuild reports its output map')
    assert.ok(results.pageBuildResults?.outputs.length, 'page build exposes manifest outputs at the build-step level')
    assert.ok(results.pageBuildResults?.report.pages.length, 'page build retains rendered page reports')
    assert.ok(results.pageBuildResults?.report.templates.length, 'page build retains rendered template reports')
    assert.ok(Object.keys(results.copyResults?.report ?? {}).length, 'copy build retains the underlying copy reports')
    assert.strictEqual(
      results.domstackManifest.$schema,
      DOMSTACK_MANIFEST_SCHEMA_ID,
      'domstack manifest includes its schema URL'
    )

    const domstackManifestPath = path.join(dest, 'domstack-manifest.json')
    await assert.rejects(
      () => stat(domstackManifestPath),
      'domstack manifest is not written by default'
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

    assert.ok(
      !manifestEntryByUrl.has('/service-worker.js'),
      'domstack manifest omits the site service worker to avoid circular manifest-version dependencies'
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
      'domstack manifest classifies dedicated worker bundles'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'worker' && entry.url.includes('/worker-page/shared-counter.worker-')),
      'domstack manifest classifies shared worker bundles'
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
      manifestEntryByUrl.get('/js-page/')?.manifestVars,
      { offline: false, precache: false },
      'domstack manifest includes configured page vars'
    )

    const rootEntry = manifestEntryByUrl.get('/')
    assert.strictEqual(rootEntry?.contentType, 'text/html; charset=utf-8', 'page entries include best-known content type')
    assert.strictEqual(rootEntry?.static, true, 'page entries are marked as static domstack outputs')
    assert.strictEqual(rootEntry?.role, 'navigation', 'page entries get the navigation role')
    assert.strictEqual(rootEntry?.urlRevisioned, false, 'page URLs are not marked as URL-revisioned')
    assert.match(rootEntry?.integrity ?? '', /^sha256-/, 'entries include SRI-formatted integrity metadata')

    const hashedScriptEntry = manifestEntries.find(entry => entry.kind === 'script' && entry.url.endsWith('.js'))
    assert.strictEqual(hashedScriptEntry?.urlRevisioned, true, 'hashed esbuild script URLs are marked as URL-revisioned')
    assert.strictEqual(hashedScriptEntry?.role, 'subresource', 'script entries get the subresource role')
    assert.strictEqual(hashedScriptEntry?.static, true, 'script entries are marked as static outputs')

    for (const entry of manifestEntries) {
      assert.ok(entry.url.startsWith('/'), `${entry.outputRelname} has an absolute URL`)
      assert.ok(entry.revision, `${entry.outputRelname} has a content revision`)
      assert.ok(Number.isInteger(entry.bytes), `${entry.outputRelname} has byte size`)
    }

    const serviceWorkerContent = await readFile(path.join(dest, 'service-worker.js'), 'utf8')
    assert.ok(serviceWorkerContent.includes('/domstack-manifest.json'), 'service worker was bundled')
    assert.ok(!serviceWorkerContent.includes('process.env.DOMSTACK_MANIFEST_URL'), 'service worker receives the domstack manifest URL define')
    assert.ok(!serviceWorkerContent.includes('process.env.DOMSTACK_MANIFEST_ENABLED'), 'service worker receives the domstack manifest enabled define')
    assert.ok(serviceWorkerContent.includes(results.domstackManifest.version), 'service worker receives the finalized domstack manifest version define')
    assert.ok(serviceWorkerContent.includes('cache: "no-store"'), 'service worker fetches the domstack manifest at runtime')
    assert.ok(serviceWorkerContent.includes('caches.match(request)'), 'service worker has cache-first fetch handling')

    const metaContent = await readFile(path.join(dest, 'domstack-esbuild-meta.json'), 'utf8')
    const metaData = JSON.parse(metaContent)
    assert.ok(
      !Object.keys(metaData.outputs).some(outputPath => outputPath.endsWith('/service-worker.js')),
      'domstack app esbuild metafile omits the final service worker build'
    )

    const stableSite = new DomStack(src, dest, { copy: [path.join(__dirname, './copyfolder')] })
    const stableResults = await stableSite.build()

    assert.strictEqual(
      stableResults.domstackManifest?.version,
      results.domstackManifest.version,
      'domstack manifest version is stable across identical builds'
    )

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

    const generatedGlobalStyle = files.some(f => f.relname.match(/global-([A-Z0-9])\w+.css/g))
    assert.equal(generatedGlobalStyle, globalAssets.globalStyle, `${globalAssets.globalStyle
            ? 'Generated'
            : 'Did not generate'} a global style`)

    const generatedGlobalClient = files.some(f => f.relname.match(/global.client-([A-Z0-9])\w+.js/g))
    assert.equal(generatedGlobalClient, globalAssets.globalClient, `${globalAssets.globalClient
            ? 'Generated'
            : 'Did not generate'} a global client`)

    const generatedPageClient = files.some(f => f.relname.match(/client-([A-Z0-9])\w+.js/g))
    assert.ok(generatedPageClient, 'Generated a page client file')
    const generatedPageStyle = files.some(f => f.relname.match(/style-([A-Z0-9])\w+.css/g))
    assert.ok(generatedPageStyle, 'Generated a page style file')

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

    // Test for web worker functionality
    await t.test('should support dedicated and shared web workers', async () => {
      // Check for worker files in the output
      const dedicatedWorkerFiles = files.filter(f => f.relname.includes('worker-page/counter.worker-'))
      const sharedWorkerFiles = files.filter(f => f.relname.includes('worker-page/shared-counter.worker-'))
      assert.ok(dedicatedWorkerFiles.length > 0, 'Dedicated worker files were bundled')
      assert.ok(sharedWorkerFiles.length > 0, 'Shared worker files were bundled')

      const workerMappings = JSON.parse(await readFile(path.join(dest, 'worker-page/workers.json'), 'utf8'))
      assert.match(workerMappings.counter, /^counter\.worker-[A-Z0-9]+\.js$/)
      assert.match(workerMappings['shared-counter'], /^shared-counter\.worker-[A-Z0-9]+\.js$/)

      // Check that the metafile contains worker entries
      const metaFilePath = path.join(dest, 'domstack-esbuild-meta.json')
      const metaContent = await readFile(metaFilePath, 'utf8')
      const metaData = JSON.parse(metaContent)

      // Verify worker files in the outputs section of the metafile
      const workerOutputPaths = Object.keys(metaData.outputs)
      assert.ok(
        workerOutputPaths.some(outputPath => outputPath.includes('worker-page/counter.worker-')),
        'Dedicated worker output found in metafile'
      )
      assert.ok(
        workerOutputPaths.some(outputPath => outputPath.includes('worker-page/shared-counter.worker-')),
        'Shared worker output found in metafile'
      )

      // Check the worker page HTML content
      const workerPagePath = path.join(dest, 'worker-page/index.html')
      const workerContent = await readFile(workerPagePath, 'utf8')
      const workerDoc = cheerio.load(workerContent)

      // Verify the counter display element exists
      const counterElement = workerDoc('#counter')
      assert.ok(counterElement.length > 0, 'Counter element exists in worker page')
    })

    for (const [filePath, assertions] of Object.entries(pages)) {
      try {
        const fullPath = path.join(dest, filePath)
        const contents = await readFile(fullPath, 'utf8')
        const doc = cheerio.load(contents)

        const headScripts = Array.from(doc('head script[type="module"]'))

        const hasGlboalClientHeader = headScripts.map(n => n?.attribs?.['src'])?.some(src => src && src.match(/global.client-([A-Z0-9])\w+.js/g))
        const hasPageClientHeader = headScripts.map(n => n?.attribs?.['src']).some(src => src && src.match(/\.\/client-([A-Z0-9])\w+.js/g))

        const headLinks = Array.from(doc('head link[rel="stylesheet"]'))
        const hasGlobalStyleHeader = headLinks.map(n => n?.attribs?.['href']).some(href => href && href.match(/global-([A-Z0-9])\w+.css/g))
        const hasPageStyleHeader = headLinks.map(n => n?.attribs?.['href']).some(href => href && href.match(/\.\/style-([A-Z0-9])\w+.css/g))

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

        assert.equal(
          hasPageStyleHeader,
          assertions.style,
                    `${filePath} ${assertions.client
                        ? 'Includes'
                        : 'Does not include'} a page style header`)
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
