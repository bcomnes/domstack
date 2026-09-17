/** @import { DomstackManifestEntry } from '#types' */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DomStack, testBuild, reconcileDomstackManifest } from '../../index.js'
import * as path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const __dirname = path.resolve(import.meta.dirname, '../../test-cases/general-features')
const src = path.join(__dirname, 'src')

test('domstackManifest version includes cache-relevant metadata', async (t) => {
  const dest = await mkdtemp(path.join(tmpdir(), 'domstack-manifest-test-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  const basePage = {
    path: '',
    url: '/',
  }
  /** @type {DomstackManifestEntry} */
  const baseEntry = {
    outputRelname: 'index.html',
    kind: 'page',
    url: '/',
    revision: 'same-file-revision',
    bytes: 42,
    sourceRelname: 'pages/index.js',
    page: basePage,
  }

  const { manifest: baseManifest } = await reconcileDomstackManifest({ dest, entries: [baseEntry] })
  const { manifest: sourceOnlyManifest } = await reconcileDomstackManifest({
    dest,
    entries: [{
      ...baseEntry,
      sourceRelname: 'pages/renamed-index.js',
    }],
  })
  const { manifest: kindChangedManifest } = await reconcileDomstackManifest({
    dest,
    entries: [{
      ...baseEntry,
      kind: 'template',
    }],
  })
  const { manifest: offlineChangedManifest } = await reconcileDomstackManifest({
    dest,
    entries: [{
      ...baseEntry,
      manifestVars: {
        offline: false,
      },
    }],
  })
  const { manifest: manifestVarsManifest } = await reconcileDomstackManifest({
    dest,
    entries: [{
      ...baseEntry,
      manifestVars: {
        precache: true,
      },
    }],
  })
  const { manifest: policyManifest } = await reconcileDomstackManifest({
    dest,
    entries: [{
      ...baseEntry,
      manifestVars: {
        precache: true,
      },
    }],
    options: {
      policy ({ entries }) {
        return {
          precacheUrls: entries
            .filter(entry => entry.manifestVars?.['precache'] === true)
            .map(entry => entry.url),
        }
      },
    },
  })
  const { manifest: objectPrecacheManifest } = await reconcileDomstackManifest({
    dest,
    entries: [{
      ...baseEntry,
      manifestVars: {
        precache: { core: true, priority: 1 },
      },
    }],
  })
  const { manifest: reorderedObjectPrecacheManifest } = await reconcileDomstackManifest({
    dest,
    entries: [{
      ...baseEntry,
      manifestVars: {
        precache: { priority: 1, core: true },
      },
    }],
  })

  assert.strictEqual(
    sourceOnlyManifest.version,
    baseManifest.version,
    'source metadata does not affect domstack manifest version'
  )
  assert.notStrictEqual(
    kindChangedManifest.version,
    baseManifest.version,
    'kind affects domstack manifest version'
  )
  assert.notStrictEqual(
    offlineChangedManifest.version,
    baseManifest.version,
    'configured manifest vars affect domstack manifest version'
  )
  assert.deepStrictEqual(
    manifestVarsManifest.entries[0]?.manifestVars,
    { precache: true },
    'manifestVars exposes selected application policy'
  )
  assert.deepStrictEqual(
    policyManifest.policy,
    { precacheUrls: ['/'] },
    'policy transform exposes derived root manifest policy'
  )
  assert.notStrictEqual(
    manifestVarsManifest.version,
    baseManifest.version,
    'manifestVars affect domstack manifest version'
  )
  assert.notStrictEqual(
    policyManifest.version,
    baseManifest.version,
    'policy affects domstack manifest version'
  )
  assert.strictEqual(
    reorderedObjectPrecacheManifest.version,
    objectPrecacheManifest.version,
    'object-valued manifest policy uses stable key ordering'
  )
})

test('domstackManifest warns when output producers conflict', async (t) => {
  const dest = await mkdtemp(path.join(tmpdir(), 'domstack-manifest-test-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  /** @type {DomstackManifestEntry} */
  const copyEntry = {
    outputRelname: 'index.html',
    kind: 'copy',
    url: '/',
    revision: 'same-file-revision',
    bytes: 42,
    sourceRelname: 'static/index.html',
  }
  const pageEntry = {
    ...copyEntry,
    kind: /** @type {const} */ ('page'),
    sourceRelname: 'pages/index.js',
  }

  const { manifest, warnings } = await reconcileDomstackManifest({
    dest,
    entries: [copyEntry, pageEntry],
  })
  const { warnings: equivalentWarnings } = await reconcileDomstackManifest({
    dest,
    entries: [copyEntry, { ...copyEntry }],
  })

  assert.strictEqual(manifest.entries[0]?.kind, 'page', 'kind priority still selects the winning record')
  assert.deepStrictEqual(warnings, [{
    code: 'DOM_STACK_WARNING_CONFLICTING_MANIFEST_OUTPUT',
    message: 'Conflicting manifest records target "index.html" (kind, sourceRelname differ); keeping page record from "pages/index.js".',
  }])
  assert.deepStrictEqual(equivalentWarnings, [], 'equivalent duplicate observations remain quiet')
})

test('domstackManifest exclude handles root page URL', async (t) => {
  const excludeBuild = await testBuild(src, {
    copy: [path.join(__dirname, './copyfolder')],
    domstackManifest: {
      exclude: ['oldsite/**'],
      includeEntry: entry => entry.kind !== 'copy',
    },
  })
  t.after(async () => {
    await excludeBuild.cleanup()
  })

  const excludeEntries = /** @type {DomstackManifestEntry[]} */ (excludeBuild.results.domstackManifest?.entries ?? [])

  assert.ok(
    excludeEntries.some(entry => entry.url === '/'),
    'root page URL survives non-root exclude filters'
  )
  assert.ok(
    !excludeEntries.some(entry => entry.url.startsWith('/oldsite/')),
    'exclude filters still remove matching output paths'
  )
  assert.ok(
    !excludeEntries.some(entry => entry.kind === 'copy'),
    'programmatic domstackManifest includeEntry is applied'
  )
})

test('domstack-manifest.settings.js filters domstack manifest entries', async (t) => {
  const settingsSrc = await mkdtemp(path.join(tmpdir(), 'domstack-manifest-settings-'))
  const settingsDest = await mkdtemp(path.join(tmpdir(), 'domstack-manifest-settings-public-'))
  t.after(async () => {
    await rm(settingsSrc, { recursive: true, force: true })
    await rm(settingsDest, { recursive: true, force: true })
  })

  await mkdir(path.join(settingsSrc, 'kept'), { recursive: true })
  await mkdir(path.join(settingsSrc, 'programmatic'), { recursive: true })
  await mkdir(path.join(settingsSrc, 'settings'), { recursive: true })
  await writeFile(path.join(settingsSrc, 'page.js'), 'export default () => "<p>Domstack manifest settings</p>"\n')
  await writeFile(path.join(settingsSrc, 'service-worker.js'), 'console.log(process.env.DOMSTACK_MANIFEST_URL, DOMSTACK_TEST_SERVICE_WORKER_POLICY.message)\n')
  await writeFile(path.join(settingsSrc, 'kept/page.js'), 'export default () => "<p>Kept</p>"\n')
  await writeFile(path.join(settingsSrc, 'programmatic/page.js'), 'export default () => "<p>Programmatic exclude</p>"\n')
  await writeFile(path.join(settingsSrc, 'settings/page.js'), 'export default () => "<p>Settings exclude</p>"\n')
  await writeFile(path.join(settingsSrc, 'domstack-manifest.settings.js'), `
export default async function domstackManifestSettings () {
  return {
    exclude: ['settings/**'],
    includeEntry (entry) {
      return entry.kind !== 'sourcemap'
    },
    hooks: {
      manifestBuilt: [context => {
        context.defineServiceWorkerConstant('DOMSTACK_TEST_SERVICE_WORKER_POLICY', {
          message: 'from-manifest-hook',
          version: context.manifest.version,
        })
      }],
    },
  }
}
`)

  const settingsSite = new DomStack(settingsSrc, settingsDest, {
    domstackManifest: {
      exclude: ['programmatic/**'],
      includeEntry: () => false,
      write: true,
    },
  })

  const settingsResults = await settingsSite.build()
  const settingsEntries = /** @type {DomstackManifestEntry[]} */ (settingsResults.domstackManifest?.entries ?? [])

  const settingsServiceWorkerContent = await readFile(path.join(settingsDest, 'service-worker.js'), 'utf8')

  await stat(path.join(settingsDest, 'domstack-manifest.json'))
  assert.ok(
    settingsServiceWorkerContent.includes('/domstack-manifest.json'),
    'service worker define receives the standard domstack manifest URL'
  )
  assert.ok(
    settingsServiceWorkerContent.includes('from-manifest-hook'),
    'manifestBuilt hook can define constants for the final service-worker bundle'
  )
  assert.ok(
    settingsEntries.some(entry => entry.url === '/'),
    'root page survives domstack manifest settings filters'
  )
  assert.ok(
    settingsEntries.some(entry => entry.url === '/kept/'),
    'settings-file includeEntry takes precedence over the programmatic hook'
  )
  assert.ok(
    !settingsEntries.some(entry => entry.url === '/programmatic/'),
    'programmatic domstackManifest exclude is applied'
  )
  assert.ok(
    !settingsEntries.some(entry => entry.url === '/settings/'),
    'domstack-manifest.settings.js exclude is applied'
  )
  assert.ok(
    !settingsEntries.some(entry => entry.kind === 'sourcemap'),
    'domstack-manifest.settings.js includeEntry is applied'
  )
})

test('domstackManifest true writes the default manifest file', async (t) => {
  const writtenManifestBuild = await testBuild(src, { domstackManifest: true })
  t.after(async () => {
    await writtenManifestBuild.cleanup()
  })

  const writtenManifestDest = writtenManifestBuild.dest
  /** @type {{ version: string, entries: Record<string, unknown>[] }} */
  const writtenManifest = JSON.parse(await readFile(path.join(writtenManifestDest, 'domstack-manifest.json'), 'utf8'))
  assert.strictEqual(
    writtenManifest.version,
    writtenManifestBuild.results.domstackManifest?.version,
    'domstackManifest true writes the returned manifest to disk'
  )
  assert.ok(
    writtenManifest.entries.every(entry => !('filepath' in entry)),
    'written domstack manifest does not expose absolute filesystem paths'
  )
})

test('build without manifest settings or write request skips domstack manifest pipeline', async (t) => {
  const noManifestSrc = await mkdtemp(path.join(tmpdir(), 'domstack-no-manifest-'))
  const noManifestDest = await mkdtemp(path.join(tmpdir(), 'domstack-no-manifest-public-'))
  t.after(async () => {
    await rm(noManifestSrc, { recursive: true, force: true })
    await rm(noManifestDest, { recursive: true, force: true })
  })

  await writeFile(path.join(noManifestSrc, 'page.js'), 'export default () => "<p>No manifest settings</p>"\n')
  await writeFile(path.join(noManifestSrc, 'service-worker.js'), 'console.log(process.env.DOMSTACK_MANIFEST_URL, process.env.DOMSTACK_MANIFEST_ENABLED)\n')
  const noManifestResults = await new DomStack(noManifestSrc, noManifestDest).build()
  const noManifestServiceWorkerContent = await readFile(path.join(noManifestDest, 'service-worker.js'), 'utf8')

  assert.strictEqual(noManifestResults.domstackManifest, undefined, 'build does not return a domstack manifest without a consumer')
  await assert.rejects(
    () => stat(path.join(noManifestDest, 'domstack-manifest.json')),
    'domstack manifest is not written without an explicit write request'
  )
  assert.ok(
    noManifestServiceWorkerContent.includes('/domstack-manifest.json'),
    'standard domstack manifest URL define remains stable even when the pipeline is disabled'
  )
})
