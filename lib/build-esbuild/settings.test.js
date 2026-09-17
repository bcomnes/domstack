/** @import { DomstackManifestEntry } from '#types' */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DomStack, testBuild } from '../../index.js'
import * as path from 'node:path'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { allFiles } from 'async-folder-walker'
const __dirname = path.resolve(import.meta.dirname, '../../test-cases/general-features')
const src = path.join(__dirname, 'src')

test('metafile false skips esbuild metadata without breaking domstack manifest', async (t) => {
  const noMetaBuild = await testBuild(src, {
    copy: [path.join(__dirname, './copyfolder')],
    metafile: false,
  })
  t.after(async () => {
    await noMetaBuild.cleanup()
  })

  const noMetaDest = noMetaBuild.dest
  const noMetaResults = noMetaBuild.results
  const noMetaEntries = /** @type {DomstackManifestEntry[]} */ (noMetaResults.domstackManifest?.entries ?? [])

  assert.ok(noMetaResults.domstackManifest, 'build returned a domstack manifest with metafile disabled')
  assert.ok(
    noMetaEntries.some(entry => entry.kind === 'script'),
    'domstack manifest still includes esbuild script outputs'
  )
  assert.ok(
    noMetaEntries.some(entry => entry.kind === 'sourcemap'),
    'domstack manifest still includes esbuild sourcemap outputs'
  )
  assert.ok(
    !noMetaEntries.some(entry => entry.kind === 'metadata' && entry.url === '/domstack-esbuild-meta.json'),
    'domstack manifest does not include skipped esbuild metafile'
  )
  await assert.rejects(
    () => stat(path.join(noMetaDest, 'domstack-esbuild-meta.json')),
    'esbuild metafile was not written'
  )
})

test('esbuild settings cannot drop reserved DOMSTACK defines', async (t) => {
  const defineSrc = await mkdtemp(path.join(tmpdir(), 'domstack-esbuild-defines-'))
  t.after(async () => {
    await rm(defineSrc, { recursive: true, force: true })
  })

  await writeFile(path.join(defineSrc, 'page.js'), 'export default () => "<p>DOMSTACK defines</p>"\n')
  await writeFile(path.join(defineSrc, 'global.client.js'), `
console.log(
  process.env.DOMSTACK_MANIFEST_URL,
  process.env.DOMSTACK_SERVICE_WORKER_URL,
  process.env.CUSTOM_DEFINE,
  process.env.ESBUILD_SETTINGS_CALL
)
`)
  await writeFile(path.join(defineSrc, 'service-worker.js'), `
console.log(
  process.env.DOMSTACK_MANIFEST_URL,
  process.env.DOMSTACK_SERVICE_WORKER_SCOPE,
  process.env.CUSTOM_DEFINE,
  process.env.ESBUILD_SETTINGS_CALL
)
`)
  await writeFile(path.join(defineSrc, 'esbuild.settings.js'), `
let invocationCount = 0

export default function esbuildSettings (opts) {
  invocationCount += 1
  return {
    ...opts,
    define: {
      'process.env.CUSTOM_DEFINE': JSON.stringify('from-settings'),
      'process.env.ESBUILD_SETTINGS_CALL': JSON.stringify(\`call-\${invocationCount}\`),
    },
  }
}
`)

  const defineBuild = await testBuild(defineSrc)
  t.after(async () => {
    await defineBuild.cleanup()
  })

  const defineFiles = await allFiles(defineBuild.dest, { shaper: fwData => fwData })
  const globalClientFile = defineFiles.find(file => file.relname.match(/global\.client-.+\.js$/))
  assert.ok(globalClientFile, 'global client bundle was written')

  const globalClientContent = await readFile(path.join(defineBuild.dest, globalClientFile.relname), 'utf8')
  const defineServiceWorkerContent = await readFile(path.join(defineBuild.dest, 'service-worker.js'), 'utf8')

  assert.ok(globalClientContent.includes('/domstack-manifest.json'), 'global client keeps domstack manifest URL define')
  assert.ok(globalClientContent.includes('/service-worker.js'), 'global client keeps service worker URL define')
  assert.ok(globalClientContent.includes('from-settings'), 'global client keeps user esbuild define')
  assert.ok(!globalClientContent.includes('process.env.DOMSTACK_'), 'global client has no unreplaced DOMSTACK defines')
  assert.ok(defineServiceWorkerContent.includes('/domstack-manifest.json'), 'service worker keeps domstack manifest URL define')
  assert.match(defineServiceWorkerContent, /["']\/["']/, 'service worker keeps service worker scope define')
  assert.ok(defineServiceWorkerContent.includes('from-settings'), 'service worker keeps user esbuild define')
  assert.ok(globalClientContent.includes('call-1'), 'browser build uses the first resolved settings result')
  assert.ok(defineServiceWorkerContent.includes('call-1'), 'service worker reuses the resolved browser settings')
  assert.ok(!defineServiceWorkerContent.includes('call-2'), 'service worker does not invoke esbuild settings again')
  assert.ok(!defineServiceWorkerContent.includes('process.env.DOMSTACK_'), 'service worker has no unreplaced DOMSTACK defines')
})

test('esbuild settings cannot override reserved DOMSTACK defines', async (t) => {
  const conflictSrc = await mkdtemp(path.join(tmpdir(), 'domstack-esbuild-define-conflict-'))
  const conflictDest = await mkdtemp(path.join(tmpdir(), 'domstack-esbuild-define-conflict-public-'))
  t.after(async () => {
    await rm(conflictSrc, { recursive: true, force: true })
    await rm(conflictDest, { recursive: true, force: true })
  })

  await writeFile(path.join(conflictSrc, 'page.js'), 'export default () => "<p>DOMSTACK define conflict</p>"\n')
  await writeFile(path.join(conflictSrc, 'global.client.js'), 'console.log(process.env.DOMSTACK_MANIFEST_URL)\n')
  await writeFile(path.join(conflictSrc, 'esbuild.settings.js'), `
export default function esbuildSettings (opts) {
  return {
    ...opts,
    define: {
      ...opts.define,
      'process.env.DOMSTACK_MANIFEST_URL': JSON.stringify('/not-domstack-owned.json'),
    },
  }
}
`)

  await assert.rejects(
    () => new DomStack(conflictSrc, conflictDest).build(),
    error => {
      if (!(error instanceof Error)) return false
      const buildError = /** @type {Error & { errors?: Array<Error & { cause?: unknown }> }} */ (error)
      return error.message.includes('Prebuild finished but there were errors') &&
            buildError.errors?.some(err => {
              const cause = err.cause
              return err.message.includes('Error building JS+CSS with esbuild') &&
                cause instanceof Error &&
                cause.message.includes('process.env.DOMSTACK_MANIFEST_URL') &&
                cause.message.includes('reserved by domstack')
            }) === true
    },
    'reserved DOMSTACK define conflicts fail clearly'
  )
})
