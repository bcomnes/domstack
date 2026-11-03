/** @import { DocsPageVars } from './navigation.js' */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'cheerio'
import { load as loadYaml } from 'js-yaml'
import { renderMd } from '../../../lib/build-pages/page-builders/md/get-md.js'
import { parseMdFileContents } from '../../../lib/build-pages/page-builders/md/parse-md.js'
import { collectDocsNavigation } from './navigation.js'

const docsRoot = fileURLToPath(new URL('../../../docs/', import.meta.url))
const siteOrigin = 'https://docs.invalid'
const guides = ['composition-pages', 'page-outputs', 'incremental-global-data', 'output-manifest', 'layout-registry']

/** @param {string} directory @returns {Promise<string[]>} */
async function markdownFiles (directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(path) : Promise.resolve(entry.name.endsWith('.md') ? [path] : [])
  }))
  return nested.flat()
}

/** @param {string} path */
async function readPage (path) {
  const source = parseMdFileContents(await readFile(path, 'utf8'))
  const vars = /** @type {DocsPageVars} */ (loadYaml(source.frontMatterUnparsed ?? '') ?? {})
  const relname = relative(docsRoot, path).split(sep).join('/')
  const url = '/docs/' + (relname.endsWith('README.md') ? relname.slice(0, -'README.md'.length) : relname.replace(/\.md$/, '.html'))
  const html = await renderMd(source.markdownContent, {})
  return { url, vars, html, document: load(html) }
}

test('checked-in advanced guides nest in order and core reference anchors remain available', async () => {
  const pages = await Promise.all([
    join(docsRoot, 'advanced/README.md'),
    ...guides.map(guide => join(docsRoot, 'advanced', guide, 'README.md')),
  ].map(readPage))
  const navigation = await collectDocsNavigation(pages.map(page => ({
    pageInfo: { type: 'md', url: page.url },
    vars: page.vars,
    renderInnerPage: async () => page.html,
  })))
  assert.equal(navigation.length, 1)
  assert.equal(navigation[0]?.title, 'Advanced')
  assert.deepEqual(navigation[0]?.sections.map(entry => entry.url), guides.map(guide => `/docs/advanced/${guide}/`))

  for (const [section, anchor, guide] of [
    ['pages', 'page-outputs', 'page-outputs'],
    ['data', 'incremental-global-data', 'incremental-global-data'],
    ['workers', 'domstack-manifest', 'output-manifest'],
    ['layouts', 'inferring-registered-layout-chains', 'layout-registry'],
    ['layouts', 'validating-supplied-page-vars', 'layout-registry'],
    ['generation', 'registered-layouts-for-generated-pages', 'layout-registry'],
    ['typescript', 'advanced-type-parameters', 'layout-registry'],
  ]) {
    assert.ok(section && anchor && guide)
    const page = await readPage(join(docsRoot, section, 'README.md'))
    const heading = page.document(`[id="${anchor}"]`)
    assert.equal(heading.length, 1, `preserve ${page.url}#${anchor}`)
    assert.ok(heading.nextAll().find('a').toArray().some(link => {
      const href = page.document(link).attr('href')
      return href && new URL(href, siteOrigin + page.url).pathname === `/docs/advanced/${guide}/`
    }), `${page.url}#${anchor} links to its advanced guide`)
  }
})

test('advanced guide links resolve to documentation pages and rendered heading anchors', async () => {
  const pages = await Promise.all((await markdownFiles(docsRoot)).map(readPage))
  const byUrl = new Map(pages.map(page => [page.url, page]))
  let checked = 0
  for (const page of pages.filter(page => page.url.startsWith('/docs/advanced/'))) {
    for (const link of page.document('a[href]').toArray()) {
      const href = page.document(link).attr('href')
      if (!href) continue
      const target = new URL(href, siteOrigin + page.url)
      if (target.origin !== siteOrigin) continue
      assert.ok(target.pathname.startsWith('/docs/'), `${page.url} links outside documentation: ${href}`)
      const destination = byUrl.get(target.pathname)
      assert.ok(destination, `${page.url}: missing page for ${href}`)
      if (target.hash) {
        const id = decodeURIComponent(target.hash.slice(1))
        assert.ok(destination.document('[id]').toArray().some(element => destination.document(element).attr('id') === id),
          `${page.url}: missing anchor for ${href}`)
      }
      checked++
    }
  }
  assert.ok(checked > guides.length, 'check guide cross-references as well as landing-page links')
})
