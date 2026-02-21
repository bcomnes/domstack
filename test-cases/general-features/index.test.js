import { test } from 'node:test'
import assert from 'node:assert'
import { DomStack } from '../../index.js'
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
      const metaFilePath = path.join(dest, 'dom-stack-esbuild-meta.json')
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

        const wroteDomstackEsbuildMetaFile = files.find(f => f.relname.match(/dom-stack-esbuild-meta.json/g))

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
          'wrote out the dom-stack-esbuild-meta.json file'
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
