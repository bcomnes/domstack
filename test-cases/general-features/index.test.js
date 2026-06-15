import { test } from 'node:test'
import assert from 'node:assert'
import { BUILD_OUTPUT_MANIFEST_SCHEMA_ID, DomStack } from '../../index.js'
import * as path from 'path'
import { rm, stat, readFile } from 'fs/promises'
import * as cheerio from 'cheerio'
import { allFiles } from 'async-folder-walker'

const __dirname = import.meta.dirname

test.describe('general-features', () => {
  test('should build site with all features', async (t) => {
    const src = path.join(__dirname, './src')
    const dest = path.join(__dirname, './public')
    const siteUp = new DomStack(src, dest, { copy: [path.join(__dirname, './copyfolder')] })

    await rm(dest, { recursive: true, force: true })

    const results = await siteUp.build()
    assert.ok(results, 'DomStack built site and returned build results')
    assert.ok(results.outputManifest, 'build returned an output manifest')
    assert.strictEqual(
      results.outputManifest.$schema,
      BUILD_OUTPUT_MANIFEST_SCHEMA_ID,
      'build output manifest includes its schema URL'
    )

    const outputManifestPath = path.join(dest, 'domstack-output-manifest.json')
    const writtenOutputManifest = JSON.parse(await readFile(outputManifestPath, 'utf8'))
    assert.strictEqual(
      writtenOutputManifest.$schema,
      results.outputManifest.$schema,
      'written output manifest schema URL matches returned output manifest'
    )
    assert.strictEqual(
      writtenOutputManifest.version,
      results.outputManifest.version,
      'written output manifest matches returned output manifest'
    )

    const manifestEntries = results.outputManifest.entries
    const manifestEntryByUrl = new Map(manifestEntries.map(entry => [entry.url, entry]))

    assert.ok(manifestEntryByUrl.has('/'), 'output manifest includes root page URL')
    assert.ok(manifestEntryByUrl.has('/md-page/'), 'output manifest includes nested page URL')
    assert.ok(manifestEntryByUrl.has('/md-page/loose-md.html'), 'output manifest includes loose markdown URL')
    assert.ok(manifestEntryByUrl.has('/feeds/feed.json'), 'output manifest includes normal template output')
    assert.ok(manifestEntryByUrl.has('/service-worker.js'), 'output manifest includes service worker template output')
    assert.ok(manifestEntryByUrl.has('/worker-page/workers.json'), 'output manifest includes worker manifest')
    assert.ok(
      !manifestEntryByUrl.has('/domstack-output-manifest.json'),
      'output manifest does not include itself'
    )

    assert.ok(
      manifestEntries.some(entry => entry.kind === 'chunk' && entry.url.startsWith('/chunks/js/chunk-')),
      'output manifest classifies shared JS chunks'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'sourcemap' && entry.url.endsWith('.map')),
      'output manifest classifies source maps'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'worker' && entry.url.includes('/worker-page/counter.worker-')),
      'output manifest classifies worker bundles'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'copy' && entry.url === '/oldsite/client.js'),
      'output manifest includes copy directory outputs'
    )
    assert.ok(
      manifestEntries.some(entry => entry.kind === 'static' && entry.url === '/static.json'),
      'output manifest includes static outputs'
    )
    assert.deepStrictEqual(
      manifestEntryByUrl.get('/js-page/')?.page?.vars,
      { precache: false, offline: false },
      'output manifest includes page-level precache/offline vars'
    )

    for (const entry of manifestEntries) {
      assert.ok(entry.url.startsWith('/'), `${entry.outputRelname} has an absolute URL`)
      assert.ok(entry.revision, `${entry.outputRelname} has a content revision`)
      assert.ok(Number.isInteger(entry.bytes), `${entry.outputRelname} has byte size`)
    }

    const serviceWorkerContent = await readFile(path.join(dest, 'service-worker.js'), 'utf8')
    assert.ok(serviceWorkerContent.includes('DOMSTACK_MANIFEST_URL'), 'service worker template was emitted')
    assert.ok(
      serviceWorkerContent.includes("fetch(DOMSTACK_MANIFEST_URL, { cache: 'no-store' })"),
      'service worker fetches the output manifest at runtime'
    )
    assert.ok(serviceWorkerContent.includes('caches.match(request)'), 'service worker has cache-first fetch handling')

    const stableResults = await siteUp.build()
    assert.strictEqual(
      stableResults.outputManifest?.version,
      results.outputManifest.version,
      'output manifest version is stable across identical builds'
    )

    await t.test('metafile false skips esbuild metadata without breaking output manifest', async () => {
      const noMetaDest = path.join(__dirname, './public-no-meta')
      const noMetaSite = new DomStack(src, noMetaDest, {
        copy: [path.join(__dirname, './copyfolder')],
        metafile: false,
      })
      t.after(async () => {
        await rm(noMetaDest, { recursive: true, force: true })
      })

      await rm(noMetaDest, { recursive: true, force: true })

      const noMetaResults = await noMetaSite.build()
      const noMetaEntries = noMetaResults.outputManifest?.entries ?? []

      assert.ok(noMetaResults.outputManifest, 'build returned an output manifest with metafile disabled')
      assert.ok(
        noMetaEntries.some(entry => entry.kind === 'script'),
        'output manifest still includes esbuild script outputs'
      )
      assert.ok(
        noMetaEntries.some(entry => entry.kind === 'sourcemap'),
        'output manifest still includes esbuild sourcemap outputs'
      )
      assert.ok(
        !noMetaEntries.some(entry => entry.kind === 'metadata' && entry.url === '/domstack-esbuild-meta.json'),
        'output manifest does not include skipped esbuild metafile'
      )
      await assert.rejects(
        () => stat(path.join(noMetaDest, 'domstack-esbuild-meta.json')),
        'esbuild metafile was not written'
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
