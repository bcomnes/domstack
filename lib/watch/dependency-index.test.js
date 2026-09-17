/**
 * @import { TestContext } from 'node:test'
 * @import { SiteData } from '../builder.js'
 * @import { PageReport } from '../build-pages/index.js'
 * @import { WalkerFile, PageInfo, PageTypes } from '../identify-pages.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import pino from 'pino'
import { classifyWatchEvent } from './plan.js'
import { WatchDependencyIndex } from './dependency-index.js'

/** @returns {SiteData} */
function emptySite () {
  return {
    pages: [],
    templates: [],
    pagesFiles: [],
    layouts: {},
    globalStyle: undefined,
    globalClient: undefined,
    serviceWorker: undefined,
    globalVars: undefined,
    globalData: undefined,
    esbuildSettings: undefined,
    markdownItSettings: undefined,
    domstackManifestSettings: undefined,
    defaultStyle: null,
    defaultClient: null,
    defaultLayout: false,
    warnings: [],
    errors: [],
  }
}

/** @param {TestContext} t */
async function fixture (t) {
  const src = await mkdtemp(join(tmpdir(), 'domstack-watch-index-'))
  t.after(() => rm(src, { recursive: true, force: true }))
  const logger = pino({ level: 'silent' })
  const debug = t.mock.method(logger, 'debug')
  const index = new WatchDependencyIndex(logger)
  /** @param {string} relname @returns {WalkerFile} */
  const file = relname => ({ root: src, filepath: join(src, relname), relname, basename: basename(relname), parentName: dirname(relname) })
  /** @param {string} relname @param {string} [contents] */
  const write = async (relname, contents = 'export default {}') => {
    const info = file(relname)
    await mkdir(dirname(info.filepath), { recursive: true })
    await writeFile(info.filepath, contents)
    return info
  }
  /** @param {string} path @param {PageTypes} [type] @returns {PageInfo} */
  const page = (path, type = 'md') => ({
    pageFile: file(join(path, `page.${type}`)),
    type,
    path,
    url: `/${path}/`,
    outputName: 'index.html',
    outputRelname: join(path, 'index.html'),
    draft: false,
  })
  return { src, index, debug, file, write, page, site: emptySite() }
}

/** @param {PageInfo} page @param {string[]} layoutNames @returns {PageReport} */
function sourceReport (page, layoutNames) {
  return { pageFilePath: page.pageFile.filepath, sourcePageFilePath: page.pageFile.filepath, layoutNames, outputs: [] }
}

/** @param {string} owner @param {string[]} layoutNames @returns {PageReport} */
function generatedReport (owner, layoutNames) {
  return { pageFilePath: `${owner}/generated.html`, pagesFilePath: owner, layoutNames, outputs: [] }
}

test('snapshot exposes only routing state and shares readonly-typed references', () => {
  const index = new WatchDependencyIndex(pino({ level: 'silent' }))
  const snapshot = index.snapshot()
  const { dependencyAnalysisFailed, ...maps } = snapshot
  assert.equal(dependencyAnalysisFailed, false)
  assert.deepEqual(Object.keys(maps).sort(), [
    'layoutDepMap', 'layoutPageMap', 'pageFileMap', 'layoutFileMap',
    'pageDepMap', 'templateDepMap', 'pagesFileDepMap', 'pagesFileLayoutMap',
    'globalDataDepPaths', 'settingsDepPaths', 'esbuildEntryPoints', 'esbuildDepPaths',
  ].sort())
  for (const [key, value] of Object.entries(maps)) {
    assert.equal(value.size, 0)
    assert.equal(Reflect.get(index.snapshot(), key), value)
  }
})

test('full and targeted reports route actual source layout chains, including ancestors and no-layout pages', async t => {
  const { index, site, page, write } = await fixture(t)
  const home = page('home')
  const other = page('other')
  const bare = page('bare')
  site.pages = [home, other, bare]
  home.pageVars = await write('home/page.vars.js', 'export default { layout: "unused" }')
  for (const name of ['root', 'article', 'alternate', 'unused']) {
    site.layouts[name] = { ...await write(`${name}.layout.js`), layoutName: name }
  }
  await index.rebuild(site)
  assert.equal(index.snapshot().layoutPageMap.size, 0, 'discovery alone must not infer root or vars layouts')

  index.recordLayouts({ pages: [sourceReport(home, ['root', 'article']), sourceReport(other, ['root']), sourceReport(bare, [])] }, { filtered: false })
  await index.rebuild(site)
  let snapshot = index.snapshot()
  assert.deepEqual(snapshot.layoutPageMap, new Map([['root', new Set([home, other])], ['article', new Set([home])]]))
  assert.equal(snapshot.pageFileMap.get(home.pageVars.filepath), home)
  for (const source of site.pages) assert.equal(snapshot.pageFileMap.get(source.pageFile.filepath), source)
  assert.deepEqual(snapshot.layoutFileMap, new Map(Object.values(site.layouts).map(layout => [layout.filepath, layout.layoutName])))

  index.recordLayouts({ pages: [sourceReport(home, ['alternate'])] }, { filtered: true })
  await index.rebuild(site)
  snapshot = index.snapshot()
  assert.deepEqual(snapshot.layoutPageMap, new Map([['alternate', new Set([home])], ['root', new Set([other])]]))

  const rediscoveredHome = { ...home }
  site.pages = [rediscoveredHome, other, bare]
  await index.rebuild(site)
  assert.equal(index.snapshot().layoutPageMap.get('alternate')?.has(rediscoveredHome), true)
  assert.equal(index.snapshot().layoutPageMap.get('alternate')?.has(home), false, 'routing uses current discovery objects')

  index.recordLayouts({ pages: [sourceReport(home, ['article'])] }, { filtered: false })
  await index.rebuild(site)
  assert.deepEqual(index.snapshot().layoutPageMap, new Map([['article', new Set([rediscoveredHome])]]), 'full reports discard omitted source chains')
  site.pages = []
  await index.rebuild(site)
  assert.equal(index.snapshot().layoutPageMap.size, 0)
  assert.equal(index.snapshot().pageFileMap.size, 0)
})

test('generated owners union full reports and replace only rebuilt owners, including zero generated pages', async t => {
  const { index, file } = await fixture(t)
  const first = file('first.pages.js').filepath
  const second = file('second.pages.js').filepath
  const bare = file('bare.pages.js').filepath
  index.recordLayouts({
    pages: [
      generatedReport(first, ['root', 'article']), generatedReport(first, ['root', 'alternate']),
      generatedReport(second, ['root']), generatedReport(bare, []),
    ]
  }, { filtered: false })
  assert.deepEqual(index.snapshot().pagesFileLayoutMap, new Map([
    [first, new Set(['root', 'article', 'alternate'])], [second, new Set(['root'])], [bare, new Set()],
  ]))

  index.recordLayouts({ pages: [generatedReport(first, ['new']), generatedReport(second, ['ignored'])], rebuiltPagesFilePaths: [first] }, { filtered: true })
  assert.deepEqual(index.snapshot().pagesFileLayoutMap.get(first), new Set(['new']))
  assert.deepEqual(index.snapshot().pagesFileLayoutMap.get(second), new Set(['root']), 'reports do not replace owners absent from rebuilt paths')

  index.recordLayouts({ pages: [generatedReport(first, ['ignored'])] }, { filtered: true })
  assert.deepEqual(index.snapshot().pagesFileLayoutMap.get(first), new Set(['new']), 'missing rebuilt paths default to no owner updates')
  index.recordLayouts({ pages: [], rebuiltPagesFilePaths: [first] }, { filtered: true })
  assert.equal(index.snapshot().pagesFileLayoutMap.has(first), false, 'zero emitted pages remove previous layout membership')
  index.recordLayouts({ pages: [generatedReport(bare, [])], rebuiltPagesFilePaths: [bare] }, { filtered: true })
  assert.equal(index.snapshot().pagesFileLayoutMap.has(bare), false, 'targeted empty layout sets also remove membership')
  assert.deepEqual(index.snapshot().pagesFileLayoutMap.get(second), new Set(['root']))

  await index.rebuild(emptySite())
  assert.deepEqual(index.snapshot().pagesFileLayoutMap.get(second), new Set(['root']), 'discovery does not replace successful generated layout reports')
  index.recordLayouts({ pages: [] }, { filtered: false })
  assert.equal(index.snapshot().pagesFileLayoutMap.size, 0, 'full reports replace all owners')
})

test('real shared imports populate every server role, root dependency and browser route with absolute paths', async t => {
  const { index, site, file, write, page } = await fixture(t)
  await write('shared.json', '{}')
  await write('shared.js', 'import "./shared.json"; export default {}')
  const imports = 'import "./shared.js"; export default {}'
  const home = page('', 'js')
  const markdown = page('markdown')
  const html = page('html', 'html')
  await write('page.js', imports)
  await write('markdown/page.md', 'not valid JavaScript {{{')
  await write('html/page.html', '<p>not JavaScript</p>')
  home.pageVars = await write('page.vars.js', imports)
  markdown.pageVars = home.pageVars
  site.pages = [home, markdown, html]
  site.layouts['root'] = { ...await write('root.layout.js', imports), layoutName: 'root' }
  site.layouts['child'] = { ...await write('child.layout.js', 'import "./root.layout.js"; export default {}'), layoutName: 'child' }
  const template = { templateFile: await write('feed.template.js', imports), path: '', outputName: 'feed.xml' }
  const owner = { pagesFile: await write('archive.pages.js', imports), path: '', name: 'archive' }
  site.templates = [template]
  site.pagesFiles = [owner]
  site.globalData = await write('global.data.js', imports)
  site.globalVars = await write('global.vars.js', imports)
  site.markdownItSettings = await write('markdown-it.settings.js', imports)
  site.esbuildSettings = await write('esbuild.settings.js', imports)
  site.globalClient = await write('global.client.js', imports)
  site.globalStyle = await write('global.css', 'body {}')
  site.serviceWorker = await write('service-worker.js', imports)
  home.clientBundle = await write('client.tsx', imports)
  home.pageStyle = await write('style.css', 'body {}')
  home.workers = { task: await write('task.worker.js', imports) }
  site.layouts['root'].layoutClient = await write('root.layout.client.js', imports)
  site.layouts['root'].layoutStyle = await write('root.layout.css', 'body {}')
  // Discovery normally supplies absolute paths; bundle/root collectors also resolve relative inputs.
  site.globalData = { ...site.globalData, filepath: relative(process.cwd(), site.globalData.filepath) }
  site.globalClient = { ...site.globalClient, filepath: relative(process.cwd(), site.globalClient.filepath) }
  await index.rebuild(site)
  const snapshot = index.snapshot()
  assert.equal(snapshot.dependencyAnalysisFailed, false, 'markdown, HTML and CSS are not analyzed as JavaScript')
  for (const name of ['shared.js', 'shared.json']) {
    const path = file(name).filepath
    assert.deepEqual(snapshot.layoutDepMap.get(path), new Set(['root', 'child']))
    assert.deepEqual(snapshot.pageDepMap.get(path), new Set([home, markdown]))
    assert.deepEqual(snapshot.templateDepMap.get(path), new Set([template]))
    assert.deepEqual(snapshot.pagesFileDepMap.get(path), new Set([owner]))
    assert.ok(snapshot.globalDataDepPaths.has(path))
    assert.ok(snapshot.settingsDepPaths?.has(path))
    assert.ok(snapshot.esbuildDepPaths?.has(path))
  }
  assert.deepEqual(snapshot.layoutDepMap.get(file('root.layout.js').filepath), new Set(['child']))
  assert.ok(snapshot.globalDataDepPaths.has(file('global.data.js').filepath))
  for (const name of ['global.vars.js', 'markdown-it.settings.js', 'esbuild.settings.js']) {
    assert.ok(snapshot.settingsDepPaths?.has(file(name).filepath))
  }
  assert.deepEqual(snapshot.esbuildEntryPoints, new Set([
    'global.client.js', 'global.css', 'service-worker.js', 'client.tsx', 'style.css',
    'task.worker.js', 'root.layout.client.js', 'root.layout.css',
  ].map(name => file(name).filepath)))
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === 'boolean' || key === 'layoutPageMap') continue
    for (const path of value.keys()) assert.ok(isAbsolute(path), `${key}: ${path}`)
  }
  await index.rebuild(emptySite())
  for (const value of Object.values(index.snapshot())) {
    if (typeof value !== 'boolean') assert.equal(value.size, 0, 'rebuild discards stale dependency routes')
  }
})

test('shared entries retain every consumer and refresh dependencies on each rebuild without mutating earlier snapshots', async t => {
  const { index, site, file, write, page } = await fixture(t)
  const shared = await write('shared.js', 'import "./before.json"; export default {}')
  await write('before.json', '{}')
  await write('after.json', '{}')
  const home = page('home')
  const other = page('other')
  home.pageVars = shared
  other.pageVars = shared
  other.clientBundle = shared
  const direct = { ...page('', 'js'), pageFile: shared }
  site.pages = [home, other, direct]
  site.globalData = { ...shared, filepath: relative(process.cwd(), shared.filepath) }
  site.globalVars = shared
  site.markdownItSettings = shared
  site.esbuildSettings = shared
  site.layouts['root'] = { ...shared, layoutName: 'root', layoutClient: shared }
  site.layouts['child'] = { ...shared, layoutName: 'child' }
  const template = { templateFile: shared, path: '', outputName: 'feed.xml' }
  const owner = { pagesFile: shared, path: '', name: 'archive' }
  site.templates = [template]
  site.pagesFiles = [owner]
  site.globalClient = shared
  site.serviceWorker = shared
  index.recordLayouts({ pages: [sourceReport(home, ['root']), sourceReport(other, ['child'])] }, { filtered: false })

  /** @param {ReturnType<WatchDependencyIndex['snapshot']>} snapshot @param {string} dependency */
  const assertRoutes = (snapshot, dependency) => {
    const depPath = file(dependency).filepath
    assert.equal(snapshot.dependencyAnalysisFailed, false)
    assert.deepEqual(snapshot.layoutDepMap, new Map([[depPath, new Set(['root', 'child'])]]))
    assert.deepEqual(snapshot.pageDepMap, new Map([[depPath, new Set([home, other, direct])]]))
    assert.deepEqual(snapshot.templateDepMap, new Map([[depPath, new Set([template])]]))
    assert.deepEqual(snapshot.pagesFileDepMap, new Map([[depPath, new Set([owner])]]))
    assert.deepEqual(snapshot.globalDataDepPaths, new Set([shared.filepath, depPath]))
    assert.deepEqual(snapshot.settingsDepPaths, new Set([shared.filepath, depPath]))
    assert.deepEqual(snapshot.esbuildDepPaths, new Set([depPath]))
    assert.deepEqual(snapshot.esbuildEntryPoints, new Set([shared.filepath]))
  }
  await index.rebuild(site)
  const before = index.snapshot()
  assertRoutes(before, 'before.json')

  await write('shared.js', 'import "./after.json"; export default {}')
  index.recordLayouts({ pages: [sourceReport(home, ['child'])] }, { filtered: true })
  await index.rebuild(site)
  const after = index.snapshot()
  assertRoutes(after, 'after.json')
  assertRoutes(before, 'before.json')
  assert.deepEqual(before.layoutPageMap, new Map([['root', new Set([home])], ['child', new Set([other])]]))
  assert.deepEqual(after.layoutPageMap, new Map([['child', new Set([home, other])]]))
  for (const key of ['layoutDepMap', 'layoutPageMap', 'pageFileMap', 'layoutFileMap', 'pageDepMap', 'templateDepMap', 'pagesFileDepMap', 'globalDataDepPaths', 'settingsDepPaths', 'esbuildEntryPoints', 'esbuildDepPaths']) {
    assert.notEqual(Reflect.get(before, key), Reflect.get(after, key), key)
  }

  await write('shared.js')
  await index.rebuild(site)
  const empty = index.snapshot()
  assert.equal(empty.pageDepMap.size, 0, 'successful empty dependency lists replace previous imports')
  assert.deepEqual(empty.globalDataDepPaths, new Set([shared.filepath]))
  assert.equal(empty.esbuildDepPaths?.size, 0)
  assertRoutes(after, 'after.json')
})

test('shared analysis failures preserve root recovery and log every factory consumer, then retry on the next rebuild', async t => {
  const { index, site, file, write, page, debug } = await fixture(t)
  const shared = await write('shared.js', 'export const =')
  site.globalData = { ...shared, filepath: relative(process.cwd(), shared.filepath) }
  site.globalVars = shared
  site.layouts['root'] = { ...shared, layoutName: 'root' }
  const home = page('home')
  home.pageVars = shared
  site.pages = [home]
  site.templates = [{ templateFile: shared, path: '', outputName: 'feed.xml' }]
  site.pagesFiles = ['first.pages.js', 'second.pages.js'].map(relname => ({
    pagesFile: { ...shared, relname }, path: '', name: relname,
  }))
  site.globalClient = shared
  const events = [classifyWatchEvent('change', file('unknown.json').filepath)]

  for (let attempt = 0; attempt < 2; attempt++) {
    await index.rebuild(site)
    const snapshot = index.snapshot()
    assert.equal(snapshot.dependencyAnalysisFailed, true)
    assert.equal(index.filterEvents(events, { pageBuildFailed: false }), events)
    assert.deepEqual(snapshot.globalDataDepPaths, new Set([shared.filepath]))
    assert.deepEqual(snapshot.settingsDepPaths, new Set([shared.filepath]))
    assert.deepEqual(snapshot.esbuildEntryPoints, new Set([shared.filepath]))
    for (const map of [snapshot.layoutDepMap, snapshot.pageDepMap, snapshot.templateDepMap, snapshot.pagesFileDepMap, snapshot.esbuildDepPaths]) {
      assert.equal(map?.size, 0)
    }
    assert.equal(debug.mock.callCount(), (attempt + 1) * 2)
    assert.match(String(debug.mock.calls[attempt * 2]?.arguments[0]), /^Could not analyze dependencies for pages file "first\.pages\.js": .+/)
    assert.match(String(debug.mock.calls[attempt * 2 + 1]?.arguments[0]), /^Could not analyze dependencies for pages file "second\.pages\.js": .+/)
  }

  await write('shared.js', 'import "./fixed.json"; export default {}')
  await write('fixed.json', '{}')
  await index.rebuild(site)
  const recovered = index.snapshot()
  assert.equal(recovered.dependencyAnalysisFailed, false)
  assert.deepEqual(index.filterEvents(events, { pageBuildFailed: false }), [])
  assert.deepEqual(recovered.pageDepMap.get(file('fixed.json').filepath), new Set([home]))
  assert.deepEqual(recovered.pagesFileDepMap.get(file('fixed.json').filepath), new Set(site.pagesFiles))
  assert.deepEqual(recovered.esbuildDepPaths, new Set([file('fixed.json').filepath]))
  assert.equal(debug.mock.callCount(), 4, 'successful analysis does not log failures')
})

test('event filtering retains processed files and each known dependency role, preserving order and duplicates', async t => {
  const { index, site, write, file, page } = await fixture(t)
  /** @param {string} name */
  const root = async name => {
    await write(`${name}.json`, '{}')
    return write(`${name}.js`, `import "./${name}.json"; export default {}`)
  }
  site.globalData = await root('global.data')
  site.globalVars = await root('global.vars')
  site.layouts['root'] = { ...await root('root.layout'), layoutName: 'root' }
  const home = page('', 'js')
  home.pageFile = await root('page')
  site.pages = [home]
  site.templates = [{ templateFile: await root('feed.template'), path: '', outputName: 'feed.xml' }]
  site.pagesFiles = [{ pagesFile: await root('archive.pages'), path: '', name: 'archive' }]
  site.globalClient = await root('global.client')
  await index.rebuild(site)
  const known = ['global.data', 'global.vars', 'root.layout', 'page', 'feed.template', 'archive.pages', 'global.client'].map(name => `${name}.json`)
  const names = ['unknown.txt', ...known, 'unknown.js', 'unknown.md', 'unknown.css', 'unknown.html', 'unknown.tsx', 'unused.json', 'page.json']
  for (const type of /** @type {const} */ (['change', 'added', 'removed'])) {
    const events = names.map(name => classifyWatchEvent(type, file(name).filepath))
    const filtered = index.filterEvents(events, { pageBuildFailed: false })
    assert.deepEqual(filtered, events.filter(event => !['unknown.txt', 'unused.json'].includes(event.name)))
    assert.equal(filtered[0], events[1])
    assert.equal(events.length, names.length, 'filtering leaves the input array intact')
    assert.equal(index.filterEvents(events, { pageBuildFailed: true }), events, 'failed page builds bypass the filter')
    assert.deepEqual(index.filterEvents(events, { pageBuildFailed: false }), filtered, 'page failure is supplied per call, not retained')
  }
})

test('each server analysis failure enables recovery filtering until a successful rebuild and only pages files log failures', async t => {
  const { index, site, write, file, page, debug } = await fixture(t)
  site.globalData = await write('global.data.js')
  site.globalVars = await write('global.vars.js')
  site.markdownItSettings = await write('markdown-it.settings.js')
  site.esbuildSettings = await write('esbuild.settings.js')
  site.layouts['root'] = { ...await write('root.layout.js'), layoutName: 'root' }
  const home = page('', 'js')
  home.pageFile = await write('page.js')
  home.pageVars = await write('page.vars.js')
  site.pages = [home]
  site.templates = [{ templateFile: await write('feed.template.js'), path: '', outputName: 'feed.xml' }]
  site.pagesFiles = [{ pagesFile: await write('archive.pages.js'), path: '', name: 'archive' }]
  const events = [classifyWatchEvent('added', file('recovery.json').filepath)]
  for (const name of ['global.data.js', 'global.vars.js', 'markdown-it.settings.js', 'esbuild.settings.js', 'root.layout.js', 'page.js', 'page.vars.js', 'feed.template.js', 'archive.pages.js']) {
    await write(name, 'export const =')
    await index.rebuild(site)
    assert.equal(index.snapshot().dependencyAnalysisFailed, true, name)
    assert.equal(index.filterEvents(events, { pageBuildFailed: false }), events, name)
    assert.ok(index.snapshot().globalDataDepPaths.has(site.globalData.filepath), 'roots remain tracked during analysis failure')
    assert.ok(index.snapshot().settingsDepPaths?.has(site.globalVars.filepath))
    index.recordLayouts({ pages: [] }, { filtered: false })
    assert.equal(index.snapshot().dependencyAnalysisFailed, true, 'layout recording cannot clear analysis failure')
    await write(name)
    await index.rebuild(site)
    assert.equal(index.snapshot().dependencyAnalysisFailed, false, name)
    assert.deepEqual(index.filterEvents(events, { pageBuildFailed: false }), [])
  }
  assert.equal(debug.mock.callCount(), 1)
  assert.match(String(debug.mock.calls[0]?.arguments[0]), /^Could not analyze dependencies for pages file "archive\.pages\.js": .+/)
})

test('browser analysis failures retain entry points without enabling server dependency recovery', async t => {
  const { index, site, write, file, debug } = await fixture(t)
  site.globalClient = await write('global.client.js', 'export const =')
  site.globalStyle = await write('global.css', 'not JavaScript {{{')
  await index.rebuild(site)
  const snapshot = index.snapshot()
  assert.equal(snapshot.dependencyAnalysisFailed, false)
  assert.deepEqual(snapshot.esbuildEntryPoints, new Set([site.globalClient.filepath, site.globalStyle.filepath]))
  assert.equal(snapshot.esbuildDepPaths?.size, 0)
  assert.deepEqual(index.filterEvents([classifyWatchEvent('change', file('unknown.json').filepath)], { pageBuildFailed: false }), [])
  assert.equal(debug.mock.callCount(), 0)
})
