import { test } from 'node:test'
import assert from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'path'

import { identifyPages, domstackManifestSettingsNames, serviceWorkerNames } from './identify-pages.js'
import { fileConventions } from './file-conventions.js'

const __dirname = import.meta.dirname

test.describe('identify-pages', () => {
  test('identifyPages works as expected', async () => {
    const results = await identifyPages(resolve(__dirname, '../test-cases/general-features/src'))
    // console.log(results)
    assert.ok(results.globalStyle, 'Global style is found')
    assert.ok(results.globalVars, 'Global variabls are found')
    assert.ok(results.domstackManifestSettings, 'Domstack manifest settings are found')
    assert.ok(results.layouts, 'Layouts are found')

    assert.ok(results.layouts['root'], 'A root layouts is found')
    assert.equal(Object.keys(results.pages).length, 27, '27 pages are found')

    assert.equal(results.warnings.length, 1, '1 warning produced')
    assert.equal(results.warnings[0]?.code, 'DOM_STACK_WARNING_PAGE_MD_SHADOWS_README', 'page.md shadows README.md warning is produced')
    // assert.equal(results.nonPageFolders.length, 4, '4 non-page-folder')
    assert.equal(results.pages.find(p => p.path === 'html-page')?.pageFile?.type, 'html', 'html page is type html')
    assert.equal(results.pages.find(p => p.path === 'md-page')?.pageFile?.type, 'md', 'md page is type md')
    assert.equal(results.pages.find(p => p.path === 'js-page')?.pageFile?.type, 'js', 'js-page is type js')
    assert.equal(results.pages.find(p => p.path === 'page-md-page')?.pageFile?.type, 'md', 'page-md-page is type md')
    assert.equal(results.pages.find(p => p.path === 'page-md-page')?.pageFile?.basename, 'page.md', 'page-md-page uses page.md')
    assert.equal(results.pages.find(p => p.path === 'page-md-precedence')?.pageFile?.basename, 'page.md', 'page.md takes precedence over README.md')
    assert.equal(results.serviceWorker?.relname, 'globals/service-worker.mts', 'site service worker is found')
    assert.equal(results.domstackManifestSettings?.relname, 'domstack-manifest.settings.js', 'domstack manifest settings are found')
  })

  test('discovers compose and draft metadata for every supported page filename', async (t) => {
    const src = await mkdtemp(join(tmpdir(), 'domstack-compose-discovery-'))
    t.after(() => rm(src, { recursive: true, force: true }))
    const rules = [fileConventions.page, fileConventions.htmlPage, fileConventions.markdownPage, fileConventions.readmePage]
    const cases = rules.flatMap(rule => [...rule.names, ...rule.draftNames])
    for (const name of cases) {
      const dir = join(src, name)
      await mkdir(dir)
      await writeFile(join(dir, name), '')
      // Discovery must not import vars to determine composition.
      await writeFile(join(dir, 'page.vars.js'), 'throw new Error("vars must not be loaded during discovery")\n')
    }

    for (const buildDrafts of [false, true]) {
      const results = await identifyPages(src, { buildDrafts })
      assert.equal(results.errors.length, 0)
      const expected = cases.filter(name => buildDrafts || !name.includes('.draft.'))
      assert.equal(results.pages.length, expected.length)
      for (const name of expected) {
        const page = results.pages.find(page => page.path === name)
        assert.ok(page, name)
        assert.equal(page.pageFile.basename, name)
        assert.equal(page.compose, name.includes('.compose.'), name)
        assert.equal(page.draft, name.includes('.draft.'), name)
        assert.equal('emit' in page, false, name)
        assert.equal(page.outputName, 'index.html', name)
        assert.equal(page.url, `/${name}/`, name)
      }
    }
  })

  test('normal pages precede compose pages and non-drafts precede drafts', async (t) => {
    const src = await mkdtemp(join(tmpdir(), 'domstack-compose-priority-'))
    t.after(() => rm(src, { recursive: true, force: true }))
    const rules = [fileConventions.page, fileConventions.htmlPage, fileConventions.markdownPage, fileConventions.readmePage]
    const cases = rules.flatMap(rule => {
      const normal = rule.names.filter(name => !name.includes('.compose.'))
      const compose = rule.names.filter(name => name.includes('.compose.'))
      const draft = rule.draftNames.filter(name => !name.includes('.compose.'))
      const composeDraft = rule.draftNames.filter(name => name.includes('.compose.'))
      return [
        { files: [...compose, ...normal], winner: normal[0] },
        { files: [...composeDraft, ...draft], winner: draft[0] },
        { files: [...draft, ...compose], winner: compose[0] },
        { files: [...composeDraft, ...normal], winner: normal[0] },
      ]
    })
    for (const [index, { files }] of cases.entries()) {
      const dir = join(src, String(index))
      await mkdir(dir)
      for (const name of files) await writeFile(join(dir, name), '')
    }

    const results = await identifyPages(src, { buildDrafts: true })
    assert.equal(results.errors.length, 0)
    assert.equal(results.pages.length, cases.length)
    for (const [index, { winner }] of cases.entries()) {
      const page = results.pages.find(page => page.path === String(index))
      assert.ok(page)
      assert.equal(page.pageFile.basename, winner)
      assert.equal(page.compose, winner?.includes('.compose.'))
      assert.equal(page.draft, winner?.includes('.draft.'))
    }
  })

  test('loose compose Markdown gets suffix-free URLs and reserved sources are not enumerated twice', async (t) => {
    const src = await mkdtemp(join(tmpdir(), 'domstack-compose-loose-'))
    t.after(() => rm(src, { recursive: true, force: true }))
    const loose = [
      { name: 'chapter.compose.md', output: 'chapter.html', compose: true, draft: false },
      { name: 'appendix.compose.draft.md', output: 'appendix.html', compose: true, draft: true },
      { name: 'ordinary.md', output: 'ordinary.html', compose: false, draft: false },
      { name: 'notes.draft.md', output: 'notes.html', compose: false, draft: true },
      { name: 'reversed.draft.compose.md', output: 'reversed.draft.compose.html', compose: false, draft: false },
    ]
    await mkdir(join(src, 'nested'))
    for (const { name } of loose) await writeFile(join(src, 'nested', name), '')
    for (const rule of [fileConventions.markdownPage, fileConventions.readmePage]) {
      for (const name of [...rule.names, ...rule.draftNames]) await writeFile(join(src, 'nested', name), '')
    }

    for (const buildDrafts of [false, true]) {
      const results = await identifyPages(src, { buildDrafts })
      const expected = loose.filter(file => buildDrafts || !file.draft)
      assert.equal(results.pages.length, expected.length + 1)
      assert.equal(results.pages.find(page => page.outputName === 'index.html')?.pageFile.basename, 'page.md')
      for (const { name, output, compose, draft } of expected) {
        const page = results.pages.find(page => page.pageFile.basename === name)
        assert.ok(page, name)
        assert.equal(page.compose, compose, name)
        assert.equal(page.draft, draft, name)
        assert.equal('emit' in page, false, name)
        assert.equal(page.outputName, output, name)
        assert.equal(page.outputRelname, join('nested', output), name)
        assert.equal(page.url, `/nested/${output}`, name)
      }
    }
  })

  test('reversed compose/draft order is not a canonical page filename', async (t) => {
    const src = await mkdtemp(join(tmpdir(), 'domstack-compose-order-'))
    t.after(() => rm(src, { recursive: true, force: true }))
    for (const name of [...fileConventions.page.draftNames, ...fileConventions.htmlPage.draftNames].filter(name => name.includes('.compose.'))) {
      await writeFile(join(src, name.replace('.compose.draft.', '.draft.compose.')), '')
    }
    const results = await identifyPages(src, { buildDrafts: true })
    assert.equal(results.pages.length, 0)
  })

  test('identifies supported domstack manifest settings filenames', async (t) => {
    assert.ok(domstackManifestSettingsNames.includes('domstack-manifest.settings.mjs'), 'mjs domstack manifest settings names are supported')
    assert.ok(domstackManifestSettingsNames.includes('domstack-manifest.settings.cjs'), 'cjs domstack manifest settings names are supported')
    assert.ok(domstackManifestSettingsNames.includes('domstack-manifest.settings.mts'), 'mts domstack manifest settings names are supported')
    assert.ok(domstackManifestSettingsNames.includes('domstack-manifest.settings.cts'), 'cts domstack manifest settings names are supported')

    const tmp = await mkdtemp(join(tmpdir(), 'domstack-manifest-settings-'))
    t.after(async () => {
      await rm(tmp, { recursive: true, force: true })
    })

    for (const domstackManifestSettingsName of domstackManifestSettingsNames) {
      const src = join(tmp, domstackManifestSettingsName)
      const assets = join(src, 'global-assets')
      await rm(src, { recursive: true, force: true })
      await mkdir(assets, { recursive: true })
      await writeFile(join(assets, domstackManifestSettingsName), 'export default {}\n')

      const results = await identifyPages(src)

      assert.equal(results.domstackManifestSettings?.basename, domstackManifestSettingsName, `${domstackManifestSettingsName} is detected`)
      assert.equal(results.domstackManifestSettings?.relname, `global-assets/${domstackManifestSettingsName}`, `${domstackManifestSettingsName} can live below src`)
    }
  })

  test('identifies supported site service worker entry filenames', async (t) => {
    assert.ok(serviceWorkerNames.includes('service-worker.mjs'), 'mjs service worker names are supported')
    assert.ok(serviceWorkerNames.includes('service-worker.cjs'), 'cjs service worker names are supported')
    assert.ok(serviceWorkerNames.includes('service-worker.mts'), 'mts service worker names are supported')
    assert.ok(serviceWorkerNames.includes('service-worker.cts'), 'cts service worker names are supported')

    const tmp = await mkdtemp(join(tmpdir(), 'domstack-service-worker-'))
    t.after(async () => {
      await rm(tmp, { recursive: true, force: true })
    })

    for (const serviceWorkerName of serviceWorkerNames) {
      const src = join(tmp, serviceWorkerName)
      const assets = join(src, 'global-assets')
      await rm(src, { recursive: true, force: true })
      await mkdir(assets, { recursive: true })
      await writeFile(join(assets, serviceWorkerName), 'self.addEventListener("install", () => {})\n')

      const results = await identifyPages(src)

      assert.equal(results.serviceWorker?.basename, serviceWorkerName, `${serviceWorkerName} is detected`)
      assert.equal(results.serviceWorker?.relname, `global-assets/${serviceWorkerName}`, `${serviceWorkerName} can live below src`)
      assert.equal(results.errors.length, 0, `${serviceWorkerName} does not produce errors`)
    }
  })

  test('errors on duplicate site service worker entries', async (t) => {
    const src = await mkdtemp(join(tmpdir(), 'domstack-service-worker-dupe-'))
    t.after(async () => {
      await rm(src, { recursive: true, force: true })
    })

    await mkdir(join(src, 'global-assets'), { recursive: true })
    await writeFile(join(src, 'global-assets/service-worker.mjs'), 'self.addEventListener("install", () => {})\n')
    await writeFile(join(src, 'service-worker.cjs'), 'self.addEventListener("install", () => {})\n')

    const results = await identifyPages(src)
    const error = results.errors.find(error => 'code' in error && error.code === 'DOM_STACK_ERROR_DUPLICATE_SERVICE_WORKER')

    assert.ok(error, 'duplicate site service worker sources produce a clear error')
  })
})
