import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setup, assertReported } from '../build-pages/generated-pages/streaming-test-helpers.js'
import { settle } from '../build-pages/outputs/test-helpers.js'
import { startWatch } from './test-helpers.js'

/** @param {string[]} names @param {string} [failure] */
function watchFactory (names, failure) {
  return `export default async function* () {
    ${names.map(name => `yield { outputName: '${name}.html', children: '${name}' }`).join('\n')}
    ${failure ? `throw Error('${failure}')` : ''}
  }`
}

for (const change of ['recovery', 'deletion', 'empty result']) {
  test(`watch ${change} cleans successful and repeated partial factory ownership`, { timeout: 30_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'stream.pages.js': watchFactory(['old', 'stale']),
      'sibling.pages.js': watchFactory(['sibling']),
    })
    await startWatch(t, site, src)
    const sibling = await read('sibling.html')
    for (const name of ['partial', 'second-partial']) {
      await settle(site, logs, async () => {
        await writeFile(join(src, 'stream.pages.js'), watchFactory([name], `${name} failure`))
      }, `${name} failure`)
      assert.equal(await read(`${name}.html`), `<main>${name}</main>`)
      assert.equal(await read('old.html'), '<main>old</main>')
      assert.equal(await read('stale.html'), '<main>stale</main>')
      assert.equal(await read('partial.html'), '<main>partial</main>', 'repeated failure keeps earlier partial ownership')
    }
    await settle(site, logs, async () => {
      if (change === 'deletion') await rm(join(src, 'stream.pages.js'))
      else await writeFile(join(src, 'stream.pages.js'), change === 'empty result' ? 'export default null' : watchFactory(['recovered']))
    })
    for (const name of ['old', 'stale', 'partial', 'second-partial']) {
      await assert.rejects(stat(join(dest, `${name}.html`)), { code: 'ENOENT' })
    }
    if (change === 'recovery') assert.equal(await read('recovered.html'), '<main>recovered</main>')
    assert.equal(await read('sibling.html'), sibling, 'cleanup preserves sibling factory output')
    await assert.rejects(stat(join(dest, 'domstack-manifest.json')), { code: 'ENOENT' })
  })
}

for (const change of ['recovery', 'deletion', 'empty result']) {
  test(`initial failed watch retains partial generated page reports for ${change}`, { timeout: 30_000 }, async t => {
    const { site, src, dest, read, logs } = await setup(t, {
      'stream.pages.js': watchFactory(['partial', 'nested/partial'], 'initial stream failure'),
    })
    const result = await startWatch(t, site, src)
    assert.ok(logs.some(line => JSON.parse(line).msg === 'Build Failed!'))
    assert.ok(logs.some(line => line.includes('initial stream failure')))
    for (const [index, name] of ['partial', 'nested/partial'].entries()) {
      assert.equal(await read(`${name}.html`), `<main>${name}</main>`)
      assertReported(result.pageBuildResults, src, dest, `${name}.html`, 'stream.pages.js', index)
    }
    await settle(site, logs, async () => {
      if (change === 'deletion') await rm(join(src, 'stream.pages.js'))
      else await writeFile(join(src, 'stream.pages.js'), change === 'empty result' ? 'export default []' : watchFactory(['recovered']))
    })
    for (const name of ['partial', 'nested/partial']) {
      await assert.rejects(stat(join(dest, `${name}.html`)), { code: 'ENOENT' })
    }
    if (change === 'recovery') assert.equal(await read('recovered.html'), '<main>recovered</main>')
  })
}
