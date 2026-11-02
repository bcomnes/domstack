/**
 * @import { TestContext } from 'node:test'
 * @typedef {{ source: string, compose: boolean, html: string }} Fragment
 * @typedef {{ fragments: Fragment[], published: string[] }} Collection
 * @typedef {{ compose: boolean, vars: Record<string, unknown> }} Metadata
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'
import { DomStack } from '../../index.js'
import { hook, setup, settle, writeFiles } from '../build-pages/outputs/test-helpers.js'
import { startWatch } from './test-helpers.js'

/** @param {string} dest @param {string[]} names */
async function assertAbsent (dest, names) {
  for (const name of names) {
    await assert.rejects(stat(join(dest, name)), { code: 'ENOENT' }, `${name} must not be published`)
  }
}

/** @param {string} content @returns {Collection} */
const collection = content => JSON.parse(content)

// Static copying applies the default .* ignore to the helper's hidden .tmp-* root.
/** @param {TestContext} t @param {Record<string, string>} files */
async function setupVisible (t, files) {
  const root = await mkdtemp(join(import.meta.dirname, 'composition-workspace-'))
  const src = join(root, 'src')
  const dest = join(root, 'custom-output')
  await mkdir(src)
  await writeFiles(src, {
    'global.vars.js': "export default { layout: 'root' }",
    'root.layout.js': 'export default ({ children }) => children',
    ...files,
  })
  const logs = /** @type {string[]} */ ([])
  const site = new DomStack(src, dest, {
    static: true,
    domstackManifest: false,
    logger: pino({ level: 'debug' }, { write: line => logs.push(line) }),
  })
  t.after(async () => {
    if (site.watching) await site.stopWatching()
    await rm(root, { recursive: true, force: true })
  })
  return { site, src, dest, logs, read: (/** @type {string} */ name) => readFile(join(dest, name), 'utf8') }
}

const collectionData = `import assert from 'node:assert/strict'
export default async ({ pages }) => {
  for (const page of pages) {
    assert.equal(typeof page.pageInfo.compose, 'boolean', 'discovery sets compose before global data')
    assert.equal(page.pageInfo.compose, /\\.compose(?:\\.draft)?\\.[^.]+$/.test(page.pageInfo.pageFile.basename))
  }
  const fragments = pages.filter(page => page.pageInfo.pageFile.relname.startsWith('fragments/'))
    .sort((a, b) => a.pageInfo.pageFile.relname.localeCompare(b.pageInfo.pageFile.relname))
  return {
    fragments: await Promise.all(fragments.map(async page => ({
      source: page.pageInfo.pageFile.relname,
      compose: page.pageInfo.compose,
      html: await page.renderInnerPage(),
    }))),
    published: fragments.filter(page => !page.pageInfo.compose).map(page => page.pageInfo.pageFile.relname),
  }
}`

const collectionPage = `export const vars = { dataDeps: ['fragments', 'published'] }
export default ({ data }) => JSON.stringify({ fragments: data.fragments, published: data.published })`

test('watch filename composition renames clean and restore primary, sidecars and workers while assets and bundles remain unchanged', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, logs } = await setupVisible(t, {
    'root.layout.js': `export default ({ children }) => children
      export const pageOutputs = ({ page }) => {
        if (page.compose) throw Error('composition layout hook ran')
        return { outputName: 'layout.txt', content: 'layout sidecar' }
      }`,
    'article/page.md': '# Article\n',
    'article/page.vars.js': `export default {}; export const pageOutputs = ({ page }) => {
      if (page.compose) throw Error('composition page hook ran')
      return { outputName: 'page.txt', content: 'page sidecar' }
    }`,
    'article/asset.txt': 'copied asset',
    'article/style.css': 'body { color: rebeccapurple }',
    'article/client.js': 'console.log("composition client")',
    'article/task.worker.js': 'self.onmessage = () => self.postMessage("composition worker")',
  })
  await startWatch(t, site, src)
  const owned = ['article/index.html', 'article/layout.txt', 'article/page.txt', 'article/workers.json']
  const independent = ['article/asset.txt', 'article/style.css', 'article/client.js', 'article/task.worker.js']
  const baseline = await Promise.all(independent.map(name => read(name)))
  assert.equal(baseline[0], 'copied asset')
  const assertPublished = async () => {
    assert.match(await read('article/index.html'), /Article/)
    assert.equal(await read('article/layout.txt'), 'layout sidecar')
    assert.equal(await read('article/page.txt'), 'page sidecar')
    assert.deepEqual(JSON.parse(await read('article/workers.json')), { task: 'task.worker.js' })
  }
  await assertPublished()
  for (const compose of [true, false]) {
    await settle(site, logs, async () => {
      await rename(join(src, compose ? 'article/page.md' : 'article/page.compose.md'),
        join(src, compose ? 'article/page.compose.md' : 'article/page.md'))
    })
    if (compose) await assertAbsent(dest, owned)
    else await assertPublished()
    assert.deepEqual(await Promise.all(independent.map(name => read(name))), baseline,
      'filename composition changes leave copied assets and CSS, client and worker bundles intact')
  }
  await settle(site, logs, async () => {
    await rm(join(src, 'article/page.md'))
  })
  await assertAbsent(dest, owned)
  await assertAbsent(dest, ['domstack-manifest.json'])
})

test('watch composition body edits invalidate subscribed homepage data without publishing or running hooks', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, mtime, logs } = await setup(t, {
    'global.data.js': collectionData,
    'page.js': collectionPage,
    'fragments/page.compose.md': '# Original fragment\n',
    'fragments/page.vars.js': `export default {}; export const pageOutputs = () => {
      throw Error('explicit composition rendering must not run pageOutputs')
    }`,
    'unrelated/page.html': 'Unrelated page',
  })
  const result = await startWatch(t, site, src)
  const report = result.pageBuildResults?.report.pages.find(page => page.sourcePageFilePath === join(src, 'fragments/page.compose.md'))
  assert.ok(report, 'a composition page still has an ownership report')
  assert.equal(report.pageFilePath, join(dest, 'fragments/index.html'))
  assert.deepEqual(report.outputs, [], 'composition pages report empty ownership')
  let home = collection(await read('index.html'))
  assert.equal(home.fragments[0]?.compose, true)
  assert.match(home.fragments[0]?.html ?? '', /Original fragment/)
  assert.deepEqual(home.published, [])
  await assertAbsent(dest, ['fragments/index.html'])
  const unrelatedTime = await mtime('unrelated/index.html')

  await settle(site, logs, async () => {
    await writeFile(join(src, 'fragments/page.compose.md'), '# Edited fragment\n')
  })
  home = collection(await read('index.html'))
  assert.match(home.fragments[0]?.html ?? '', /Edited fragment/)
  assert.doesNotMatch(home.fragments[0]?.html ?? '', /Original fragment/)
  assert.equal(home.fragments[0]?.compose, true)
  assert.deepEqual(home.published, [])
  assert.equal(await mtime('unrelated/index.html'), unrelatedTime, 'an unsubscribed sibling is not rewritten')
  await assertAbsent(dest, ['fragments/index.html'])

  await settle(site, logs, async () => {
    await writeFile(join(src, 'fragments/page.vars.js'), 'export default {}; ' + hook('source.txt'))
  })
  await assertAbsent(dest, ['fragments/index.html', 'fragments/source.txt'])
  await settle(site, logs, async () => {
    await rename(join(src, 'fragments/page.compose.md'), join(src, 'fragments/page.md'))
  })
  home = collection(await read('index.html'))
  assert.equal(home.fragments[0]?.compose, false)
  assert.deepEqual(home.published, ['fragments/page.md'])
  assert.match(await read('fragments/index.html'), /Edited fragment/)
  assert.equal(await read('fragments/source.txt'), 'sidecar')
})

test('watch composition rename and deletion refresh collection membership and homepage', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'global.data.js': collectionData,
    'page.js': collectionPage,
    'fragments/first.compose.md': '# First fragment\n',
    'fragments/second.compose.md': '# Second fragment\n',
    'fragments/published.md': '# Published fragment\n',
  })
  await startWatch(t, site, src)
  assert.deepEqual(collection(await read('index.html')).fragments.map(row => row.source),
    ['fragments/first.compose.md', 'fragments/published.md', 'fragments/second.compose.md'])
  await settle(site, logs, async () => {
    await rename(join(src, 'fragments/first.compose.md'), join(src, 'fragments/renamed.compose.md'))
  })
  let home = collection(await read('index.html'))
  assert.deepEqual(home.fragments.map(row => row.source), ['fragments/published.md', 'fragments/renamed.compose.md', 'fragments/second.compose.md'])
  assert.match(home.fragments.find(row => row.source === 'fragments/renamed.compose.md')?.html ?? '', /First fragment/)
  assert.deepEqual(home.published, ['fragments/published.md'])
  await settle(site, logs, async () => {
    await rm(join(src, 'fragments/renamed.compose.md'))
  })
  home = collection(await read('index.html'))
  assert.deepEqual(home.fragments.map(row => row.source), ['fragments/published.md', 'fragments/second.compose.md'])
  assert.match(home.fragments.find(row => row.compose)?.html ?? '', /Second fragment/)
  assert.deepEqual(home.published, ['fragments/published.md'])
  await assertAbsent(dest, ['fragments/first.html', 'fragments/renamed.html', 'fragments/second.html',
    'fragments/first.compose.html', 'fragments/renamed.compose.html', 'fragments/second.compose.html'])
  assert.match(await read('fragments/published.html'), /Published fragment/)
})

test('watch composition draft renames exclude and restore collection membership without publishing', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'global.data.js': collectionData,
    'page.js': collectionPage,
    'fragments/page.compose.md': '# Draftable fragment\n',
  })
  await startWatch(t, site, src)
  assert.equal(collection(await read('index.html')).fragments[0]?.compose, true)
  await settle(site, logs, async () => {
    await rename(join(src, 'fragments/page.compose.md'), join(src, 'fragments/page.compose.draft.md'))
  })
  assert.deepEqual(collection(await read('index.html')), { fragments: [], published: [] })
  await settle(site, logs, async () => {
    await rename(join(src, 'fragments/page.compose.draft.md'), join(src, 'fragments/page.compose.md'))
  })
  const home = collection(await read('index.html'))
  assert.deepEqual(home.fragments.map(row => row.source), ['fragments/page.compose.md'])
  assert.equal(home.fragments[0]?.compose, true)
  assert.deepEqual(home.published, [])
  await assertAbsent(dest, ['fragments/index.html', 'fragments/page.compose.html', 'fragments/page.compose.draft.html'])
})

test('watch compose and emit vars remain ordinary merged data and cannot override filename composition', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, {
    'global.vars.js': "export default { layout: 'root', compose: false, emit: true, winner: 'global', globalOnly: 'global' }",
    'root.layout.js': `export const vars = { compose: false, emit: true, winner: 'layout', layoutOnly: 'layout' }
      export default ({ children }) => children`,
    'article/page.vars.js': "export default { compose: false, emit: true, winner: 'companion', companionOnly: 'companion' }; " + hook('sidecar.txt'),
    'article/page.compose.js': `export const vars = { compose: false, emit: true, winner: 'builder', builderOnly: 'builder' }
      export default ({ vars }) => vars.winner`,
    'ordinary/page.md': '---\ncompose: true\nemit: false\n---\n# Ordinary page\n',
    'global.data.js': `import assert from 'node:assert/strict'
      export default ({ pages }) => {
        for (const page of pages) assert.equal(typeof page.pageInfo.compose, 'boolean')
        const article = pages.find(page => page.pageInfo.pageFile.relname === 'article/page.compose.js')
        const ordinary = pages.find(page => page.pageInfo.pageFile.relname === 'ordinary/page.md')
        assert.equal(article.pageInfo.compose, true)
        assert.equal(ordinary.pageInfo.compose, false)
        return { metadata: { compose: article.pageInfo.compose, vars: article.vars } }
      }`,
    'page.js': `export const vars = { dataDeps: ['metadata'] }
      export default ({ data }) => JSON.stringify(data.metadata)`,
  })
  await startWatch(t, site, src)
  const initial = /** @type {Metadata} */ (JSON.parse(await read('index.html')))
  assert.equal(initial.compose, true)
  assert.equal(initial.vars['compose'], false)
  assert.equal(initial.vars['emit'], true)
  assert.equal(initial.vars['winner'], 'builder')
  for (const key of ['global', 'layout', 'companion', 'builder']) assert.equal(initial.vars[`${key}Only`], key)
  assert.match(await read('ordinary/index.html'), /Ordinary page/)
  await assertAbsent(dest, ['article/index.html', 'article/sidecar.txt'])

  await settle(site, logs, async () => {
    await writeFile(join(src, 'article/page.compose.js'), `export const vars = { compose: 'content variable', emit: 'also content', winner: 'edited' }
      export default ({ vars }) => vars.winner`)
  })
  const edited = /** @type {Metadata} */ (JSON.parse(await read('index.html')))
  assert.equal(edited.compose, true)
  assert.equal(edited.vars['compose'], 'content variable')
  assert.equal(edited.vars['emit'], 'also content')
  assert.equal(edited.vars['winner'], 'edited')
  await assertAbsent(dest, ['article/index.html', 'article/sidecar.txt'])
  assert.match(await read('ordinary/index.html'), /Ordinary page/)
})

/** @param {boolean | undefined} compose */
const factory = compose => `export default () => ({
  outputName: 'generated/index.html', compose: ${String(compose)},
  vars: { compose: 'ordinary variable', emit: false }, children: 'Generated content',
}); export const pageOutputs = () => { throw Error('generated factory hook must not run') }`

test('watch generated top-level compose toggles clean and restore HTML without running factory hooks', { timeout: 30_000 }, async t => {
  const { site, src, dest, read, logs } = await setup(t, { 'article.pages.js': factory(undefined) })
  await startWatch(t, site, src)
  assert.equal(await read('generated/index.html'), 'Generated content')
  for (const compose of [true, false]) {
    await settle(site, logs, async () => {
      await writeFile(join(src, 'article.pages.js'), factory(compose))
    })
    if (compose) await assertAbsent(dest, ['generated/index.html'])
    else assert.equal(await read('generated/index.html'), 'Generated content')
  }
})
