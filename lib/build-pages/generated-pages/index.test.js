/**
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
