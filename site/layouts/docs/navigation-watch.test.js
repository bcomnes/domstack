/**
 * @import { GlobalDataChanges, PageData } from '../../../types.ts'
 * @import { DocsNavigationIndex, DocsPageVars } from './navigation.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { load } from 'cheerio'
import pino from 'pino'
import { DomStack } from '../../../index.js'
import { editAndWait, startWatch } from '../../../lib/watch/test-helpers.js'
import produceDocsData from '../../globals/global.data.ts'

test('heading changes refresh shared navigation; body edits leave other pages alone', { timeout: 30_000 }, async t => {
  const root = resolve(import.meta.dirname, '../../..')
  const temp = await mkdtemp(join(root, '.tmp-docs-navigation-'))
  const src = join(temp, 'src')
  const dest = join(temp, 'public')
  const domstack = new DomStack(src, dest, { logger: pino({ level: 'silent' }) })
  t.after(async () => {
    if (domstack.watching) await domstack.stopWatching()
    await rm(temp, { recursive: true, force: true })
  })
  for (const file of [
    'site/globals/global.data.ts',
    'site/layouts/docs/navigation.js',
    'site/layouts/docs/docs.layout.js',
    'site/layouts/root/root.layout.ts',
    'site/lib/authors.ts',
    'site/lib/blog.ts',
  ]) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await cp(join(root, file), join(src, file))
  }
  /** @param {string} file @param {string} text */
  async function write (file, text) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await writeFile(join(src, file), text)
  }
  const index = '---\nlayout: docs\ndataDeps: [docsIndexHtml]\n---\n# Docs\n\n{{{ data.docsIndexHtml }}}'
  const first = '---\nlayout: docs\ndocsOrder: 10\n---\n# First\n\n## Original\n\nBody'
  await write('docs/README.md', index)
  await write('docs/first/README.md', first)
  await write('docs/second/README.md', '---\nlayout: docs\ndocsOrder: 20\n---\n# Second\n\n## Other')
  const result = await startWatch(t, domstack, src)
  assert.equal(result.pageBuildResults?.errors.length, 0)
  const output = join(dest, 'docs/second/index.html')
  assert.match(await readFile(output, 'utf8'), /first\/#original/)

  /** @param {string} file @param {string} text */
  async function edit (file, text) {
    await editAndWait(domstack, join(src, file), () => write(file, text))
  }
  const renamed = first.replace('## Original', '## Renamed')
  await edit('docs/first/README.md', renamed)
  const contents = await readFile(output, 'utf8')
  assert.match(contents, /first\/#renamed/)
  assert.doesNotMatch(contents, /first\/#original/)
  const mtime = (await stat(output)).mtimeMs
  const bodyEdited = renamed.replace('Body', 'Changed body only')
  await edit('docs/first/README.md', bodyEdited)
  assert.match(await readFile(join(dest, 'docs/first/index.html'), 'utf8'), /Changed body only/)
  assert.equal((await stat(output)).mtimeMs, mtime, 'unchanged navigation does not invalidate another page')
})

/** @param {string} html */
function indexLinks (html) {
  const $ = load(html)
  return $('.docs-index a').toArray().map(link => [$(link).attr('href'), $(link).text()])
}

test('docs producer retains navigation while rendering only the required sources', async t => {
  /** @type {string[]} */
  const rendered = []
  /** @type {DocsNavigationIndex | undefined} */
  let state
  /** @param {string} url @param {string} html @param {'md' | 'html'} [type] */
  function page (url, html, type = 'md') {
    // Only the PageData fields consumed by the real docs producer are needed here.
    return /** @type {PageData<DocsPageVars, string>} */ ({
      sourceId: `${url.slice(1)}page.${type}`,
      pageInfo: { url, type },
      vars: {},
      async renderInnerPage () { rendered.push(url); return html },
    })
  }
  const original = '<h1>First</h1><h2 id="original">Original</h2><p>Body</p>'
  let first = page('/docs/first/', original)
  const second = page('/docs/second/', '<h1>Second</h1>')
  let pages = [
    first,
    second,
    page('/docs/', '{{{ data.docsIndexHtml }}}'),
    page('/elsewhere/', '<h1>Not documentation</h1>'),
    page('/docs/html/', '<h1>Not Markdown</h1>', 'html'),
  ]
  /** @param {GlobalDataChanges<DocsPageVars, string>} changes @param {string[]} expectedRenders */
  async function run (changes, expectedRenders) {
    rendered.length = 0
    const data = await produceDocsData({
      pages,
      previousState: state,
      changes,
      setState (next) { state = structuredClone(next) },
    })
    assert.deepEqual(rendered.sort(), expectedRenders, 'actual renderInnerPage calls, including duplicates')
    assert.deepEqual(Object.keys(data).sort(), ['blogArchives', 'blogFeed', 'blogPosts', 'docsIndexHtml', 'docsNavigation'])
    return data
  }

  const initial = await run({ kind: 'reset', reason: 'initial', events: [] }, ['/docs/first/', '/docs/second/'])
  await t.test('reset renders eligible docs and publishes navigation and index links', () => {
    assert.deepEqual(initial.docsNavigation, [
      {
        title: 'First',
        url: '/docs/first/',
        sections: [{ title: 'Original', url: '/docs/first/#original', sections: [] }],
      },
      { title: 'Second', url: '/docs/second/', sections: [] },
    ])
    assert.deepEqual(indexLinks(initial.docsIndexHtml), [
      ['first/', 'First'], ['first/#original', 'Original'], ['second/', 'Second'],
    ])
    assert.deepEqual([...state?.keys() ?? []].sort(), [first.sourceId, second.sourceId])
  })
  await t.test('body delta renders only the changed doc and leaves public data unchanged', async () => {
    first = page('/docs/first/', original.replace('Body', 'Changed body'))
    pages[0] = first
    const data = await run({ kind: 'delta', upserted: [first], removed: [], events: [] }, ['/docs/first/'])
    assert.deepEqual(data, initial)
  })
  await t.test('heading delta renders only the changed doc and updates both public values', async () => {
    first = page('/docs/first/', '<h1>First</h1><h2 id="renamed">Renamed</h2><p>Changed body</p>')
    pages[0] = first
    const data = await run({ kind: 'delta', upserted: [first], removed: [], events: [] }, ['/docs/first/'])
    assert.deepEqual(data.docsNavigation, [
      {
        title: 'First',
        url: '/docs/first/',
        sections: [{ title: 'Renamed', url: '/docs/first/#renamed', sections: [] }],
      },
      initial.docsNavigation[1],
    ])
    assert.deepEqual(indexLinks(data.docsIndexHtml), [
      ['first/', 'First'], ['first/#renamed', 'Renamed'], ['second/', 'Second'],
    ])
  })
  await t.test('delete removes cached navigation without rendering surviving docs', async () => {
    pages = pages.filter(source => source.sourceId !== first.sourceId)
    const data = await run({ kind: 'delta', upserted: [], removed: [first.sourceId], events: [] }, [])
    assert.deepEqual(data.docsNavigation, [initial.docsNavigation[1]])
    assert.deepEqual(indexLinks(data.docsIndexHtml), [['second/', 'Second']])
    assert.deepEqual([...state?.keys() ?? []], [second.sourceId])
  })
})
