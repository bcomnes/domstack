/**
 * @import { TestContext } from 'node:test'
 * @import { SiteData } from '../../builder.js'
 * @import { PageInfo, PagesFileInfo } from '../../identify-pages.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveGeneratedPageInfos } from './index.js'
import { WatchDependencyTracker } from '../global-data/watch-dependencies.js'
import { DomStackOutputConflictError } from '../../helpers/domstack-error.js'

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

/** @param {string} root @param {string} name @returns {PagesFileInfo} */
function owner (root, name) {
  const basename = `${name}.pages.js`
  return {
    pagesFile: { root, filepath: join(root, basename), relname: basename, basename, parentName: '' },
    path: '',
    name,
  }
}

/** @param {TestContext} t @param {unknown} definitions */
async function resolverFixture (t, definitions) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-factory-compose-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pagesFile = owner(root, 'selected')
  await writeFile(pagesFile.pagesFile.filepath, `export default ${JSON.stringify(definitions)}`)
  const siteData = emptySite()
  siteData.pagesFiles = [pagesFile]
  return {
    siteData,
    factoryVars: {},
    globalData: {},
    pagesFileFilterSet: null,
    buildDrafts: false,
    watchDependencyTracker: new WatchDependencyTracker(null, { fullBuild: true }),
  }
}

for (const kind of ['absent', 'empty', 'unselected', 'unknown selection']) {
  test(`factory expansion skips collision setup for ${kind} factories`, async () => {
    const siteData = emptySite()
    const factory = owner('/unused', 'archive')
    if (kind === 'absent') Reflect.deleteProperty(siteData, 'pagesFiles')
    if (kind === 'unselected' || kind === 'unknown selection') siteData.pagesFiles = [factory]
    Object.defineProperty(siteData, 'pages', { get: () => assert.fail('source pages must not be scanned') })
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    Object.defineProperty(tracker.state, 'consumers', { get: () => assert.fail('previous consumers must not be scanned') })
    const pagesFileFilterSet = kind === 'unselected'
      ? new Set()
      : kind === 'unknown selection' ? new Set(['/unused/missing.pages.js']) : null
    const results = []
    for await (const page of resolveGeneratedPageInfos({
      siteData,
      factoryVars: {},
      globalData: {},
      pagesFileFilterSet,
      buildDrafts: false,
      watchDependencyTracker: tracker,
    })) results.push(page)
    assert.deepEqual(results, [])
  })
}

for (const existing of ['source', 'unselected factory']) {
  test(`selected factories still reserve outputs belonging to the ${existing}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'domstack-factory-selection-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const selected = owner(root, 'selected')
    const untouched = owner(root, 'untouched')
    await writeFile(selected.pagesFile.filepath, 'export default { outputName: "shared.html" }')
    const siteData = emptySite()
    siteData.pagesFiles = [selected, untouched]
    const tracker = new WatchDependencyTracker(null, { fullBuild: true })
    if (existing === 'source') {
      /** @type {PageInfo} */
      const page = {
        pageFile: { root, filepath: join(root, 'page.md'), relname: 'page.md', basename: 'page.md', parentName: '' },
        type: 'md',
        path: '',
        url: '/shared.html',
        outputName: 'shared.html',
        outputRelname: 'shared.html',
        draft: false,
        compose: false,
      }
      siteData.pages.push(page)
    } else {
      tracker.registerConsumer('page', 'shared.html', [], { ownerPath: untouched.pagesFile.filepath })
    }
    const definitions = resolveGeneratedPageInfos({
      siteData,
      factoryVars: {},
      globalData: {},
      pagesFileFilterSet: new Set([selected.pagesFile.filepath]),
      buildDrafts: false,
      watchDependencyTracker: tracker,
    })
    await assert.rejects(definitions.next(), error => {
      assert.ok(error instanceof DomStackOutputConflictError)
      assert.equal(error.conflict.outputPath, 'shared.html')
      return true
    })
  })
}

for (const compose of [false, true, undefined]) {
  test(`generated page metadata normalizes compose ${compose}`, async t => {
    const params = await resolverFixture(t, { compose, vars: { title: 'Generated' }, children: 'Content' })
    const pages = await Array.fromAsync(resolveGeneratedPageInfos(params))
    assert.equal(pages.length, 1)
    const page = pages[0]
    assert.ok(page)
    assert.equal(page.compose, Boolean(compose))
    assert.equal(page.draft, false)
    assert.equal(page.outputRelname, join('selected', 'index.html'))
    assert.equal(page.url, '/selected/')
    assert.equal(page.pageFile.relname, 'selected.pages.js#0')
    assert.deepEqual(page.generated?.vars, { title: 'Generated' })
    assert.equal(page.generated?.children, 'Content')
  })

  test(`concrete page with compose ${compose} ${compose === true ? 'does not reserve' : 'reserves'} its output`, async t => {
    const params = await resolverFixture(t, { outputName: 'shared.html' })
    const pagesFile = params.siteData.pagesFiles[0]
    assert.ok(pagesFile)
    /** @type {PageInfo} */
    const page = {
      pageFile: { ...pagesFile.pagesFile, relname: 'page.md' },
      type: 'md',
      path: '',
      url: '/shared.html',
      outputName: 'shared.html',
      outputRelname: 'shared.html',
      draft: false,
      compose: compose ?? false,
    }
    if (compose === undefined) Reflect.deleteProperty(page, 'compose')
    params.siteData.pages.push(page)
    const pages = resolveGeneratedPageInfos(params)
    if (compose === true) {
      const { value, done } = await pages.next()
      assert.equal(done, false)
      assert.equal(value.compose, false)
      assert.equal((await pages.next()).done, true)
    } else {
      await assert.rejects(pages.next(), DomStackOutputConflictError)
    }
  })
}

for (const field of ['compose', 'draft']) {
  for (const value of [null, 0, 1, '', 'true', [], {}]) {
    test(`generated page rejects nonboolean ${field}: ${JSON.stringify(value)}`, async t => {
      const params = await resolverFixture(t, { [field]: value })
      await assert.rejects(resolveGeneratedPageInfos(params).next(), error => {
        assert.ok(error instanceof TypeError)
        assert.equal(error.message, `Generated page ${field} must be a boolean`)
        assert.ok('pagesFile' in error)
        assert.equal(error.pagesFile, params.siteData.pagesFiles[0])
        return true
      })
    })
  }
}

for (const composedIndex of [0, 1]) {
  test(`composed page at index ${composedIndex} is yielded without claiming a shared output`, async t => {
    const definitions = [0, 1].map(index => ({ outputName: 'shared.html', compose: index === composedIndex }))
    const params = await resolverFixture(t, definitions)
    const pages = await Array.fromAsync(resolveGeneratedPageInfos(params))
    assert.equal(pages.length, 2)
    assert.equal(pages[composedIndex]?.compose, true)
    assert.equal(pages[1 - composedIndex]?.compose, false)
    assert.deepEqual(pages.map(page => page.outputRelname), ['shared.html', 'shared.html'])
  })
}

for (const compose of [false, true]) {
  test(`generated pages with compose ${compose} ${compose ? 'can share' : 'conflict on'} an output`, async t => {
    const params = await resolverFixture(t, [
      { outputName: 'shared.html', compose },
      { outputName: 'shared.html', compose },
    ])
    const pages = resolveGeneratedPageInfos(params)
    assert.equal((await pages.next()).value.compose, compose)
    if (compose) {
      assert.equal((await pages.next()).value.compose, true)
      assert.equal((await pages.next()).done, true)
    } else {
      await assert.rejects(pages.next(), DomStackOutputConflictError)
    }
  })
}

for (const existing of ['source', 'unselected factory']) {
  test(`composed page can share the output reserved by ${existing}`, async t => {
    const params = await resolverFixture(t, { outputName: 'shared.html', compose: true })
    const selected = params.siteData.pagesFiles[0]
    assert.ok(selected)
    if (existing === 'source') {
      params.siteData.pages.push({
        pageFile: { ...selected.pagesFile, relname: 'page.md' },
        type: 'md',
        path: '',
        url: '/shared.html',
        outputName: 'shared.html',
        outputRelname: 'shared.html',
        draft: false,
        compose: false,
      })
    } else {
      const untouched = owner(selected.pagesFile.root, 'untouched')
      params.siteData.pagesFiles.push(untouched)
      params.watchDependencyTracker.registerConsumer('page', 'shared.html', [], { ownerPath: untouched.pagesFile.filepath })
    }
    const pages = await Array.fromAsync(resolveGeneratedPageInfos({
      ...params,
      pagesFileFilterSet: new Set([selected.pagesFile.filepath]),
    }))
    assert.equal(pages.length, 1)
    assert.equal(pages[0]?.compose, true)
  })
}

for (const buildDrafts of [false, true]) {
  for (const compose of [false, true]) {
    test(`draft filtering is independent of compose ${compose} with buildDrafts ${buildDrafts}`, async t => {
      const params = await resolverFixture(t, [
        { outputName: 'draft.html', draft: true, compose },
        { outputName: 'published.html', draft: false, compose },
      ])
      const pages = await Array.fromAsync(resolveGeneratedPageInfos({ ...params, buildDrafts }))
      assert.equal(pages.length, buildDrafts ? 2 : 1)
      assert.ok(pages.every(page => page.compose === compose))
      assert.deepEqual(pages.map(page => page.draft), buildDrafts ? [true, false] : [false])
      assert.equal(pages.at(-1)?.pageFile.relname, 'selected.pages.js#1')
    })
  }
}

for (const buildDrafts of [false, true]) {
  test(`draft output claims follow draft filtering with buildDrafts ${buildDrafts}`, async t => {
    const params = await resolverFixture(t, [
      { outputName: 'shared.html', draft: true },
      { outputName: 'shared.html' },
    ])
    const pages = resolveGeneratedPageInfos({ ...params, buildDrafts })
    const first = await pages.next()
    assert.equal(first.value.draft, buildDrafts)
    if (buildDrafts) await assert.rejects(pages.next(), DomStackOutputConflictError)
    else assert.equal((await pages.next()).done, true)
  })
}
