import { test } from 'node:test'
import assert from 'node:assert'
import { testBuild } from '../../index.js'
import * as path from 'path'
import { readFile } from 'fs/promises'
import * as cheerio from 'cheerio'

const __dirname = import.meta.dirname

test.describe('drafts', () => {
  test('should build site with draft pages', async (t) => {
    const src = path.join(__dirname, './src')
    const build = await testBuild(src, { buildDrafts: true })
    const { dest, results } = build

    t.after(async () => {
      await build.cleanup()
    })

    assert.ok(results, 'Domstack built site and returned build results')

    const pages = {
      'index.html': {
        client: false,
        style: false,
      },
      'a-draft-html/index.html': {
        client: false,
        style: false,
      },
      'a-draft-js/index.html': {
        client: false,
        style: false,
      },
      'a-draft-md/index.html': {
        client: false,
        style: false,
      },
      'a-draft-md/loose.html': {
        client: false,
        style: false,
      },
    }

    for (const [filePath, assertions] of Object.entries(pages)) {
      try {
        const fullPath = path.join(dest, filePath)
        const contents = await readFile(fullPath, 'utf8')
        const doc = cheerio.load(contents)

        const headScripts = Array.from(doc('head script[type="module"]'))

        const hasPageClientHeader = headScripts.map(n => n?.attribs?.['src']).some(src => src && src.match(/\.\/client-([A-Z0-9])\w+.js/g))

        const headLinks = Array.from(doc('head link[rel="stylesheet"]'))
        const hasPageStyleHeader = headLinks.map(n => n?.attribs?.['href']).some(href => href && href.match(/\.\/style-([A-Z0-9])\w+.css/g))

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
  })
})
