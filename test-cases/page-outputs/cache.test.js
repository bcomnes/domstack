import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hook, setup, settle } from './helpers.js'

// Install the guard inside each build worker; parent-side reads remain available
// for assertions, and syncBuiltinESMExports also guards already-imported bindings.
const noOutputReadsLayout = `import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
const readFile = fs.readFile
fs.readFile = async (...args) => {
  if (String(args[0]).endsWith('/cached.txt')) throw Error('page-output writer reread destination bytes')
  return readFile(...args)
}
syncBuiltinESMExports()
export default ({ children }) => children`

test('watch caches identical hook bytes across workers without rereads and recreates deleted or cleaned outputs', { timeout: 30_000 }, async t => {
  const companionSource = 'export default {}; ' + hook('cached.txt', 'cached bytes')
  const { site, src, dest, read, mtime, logs } = await setup(t, {
    'root.layout.js': noOutputReadsLayout,
    'page.html': 'initial main',
    'page.vars.js': companionSource,
  })
  await site.watch({ serve: false })
  assert.equal(await read('cached.txt'), 'cached bytes')
  const originalTime = await mtime('cached.txt')
  for (const content of ['first rebuild', 'second rebuild']) {
    await settle(site, logs, async () => {
      await writeFile(join(src, 'page.html'), content)
    })
    assert.equal(await read('index.html'), content, 'the hook owner actually rebuilt')
    assert.equal(await read('cached.txt'), 'cached bytes')
    assert.equal(await mtime('cached.txt'), originalTime, 'identical bytes retain their mtime across workers')
  }

  await rm(join(dest, 'cached.txt'))
  await assert.rejects(read('cached.txt'), { code: 'ENOENT' })
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.html'), 'rebuild after destination deletion')
  })
  assert.equal(await read('cached.txt'), 'cached bytes', 'a cache hit must still validate destination existence')
  assert.notEqual(await mtime('cached.txt'), originalTime)

  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.vars.js'), 'export default {}')
  })
  await assert.rejects(read('cached.txt'), { code: 'ENOENT' })
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.vars.js'), companionSource)
  })
  assert.equal(await read('cached.txt'), 'cached bytes', 're-adding the same hook recreates the same destination and content')
  const restoredTime = await mtime('cached.txt')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.html'), 'rebuild after hook re-addition')
  })
  assert.equal(await mtime('cached.txt'), restoredTime, 're-added outputs participate in caching again')
})

test('watch repairs same-size external edits with exactly restored mtime using changed ctime', { timeout: 15_000 }, async t => {
  // Normalize writes before the writer records metadata, so utimes can restore
  // mtime exactly even on filesystems whose native timestamps have nanoseconds.
  const timestamp = 1_600_000_000
  const { site, src, dest, read, logs } = await setup(t, {
    'root.layout.js': `import fs from 'node:fs/promises'
      import { syncBuiltinESMExports } from 'node:module'
      const writeFile = fs.writeFile
      fs.writeFile = async (...args) => {
        await writeFile(...args)
        if (String(args[0]).endsWith('/metadata.txt')) await fs.utimes(args[0], ${timestamp}, ${timestamp})
      }
      syncBuiltinESMExports()
      export default ({ children }) => children`,
    'page.html': 'initial main',
    'page.vars.js': 'export default {}; ' + hook('metadata.txt', 'original'),
  })
  await site.watch({ serve: false })
  const output = join(dest, 'metadata.txt')
  const original = await stat(output, { bigint: true })
  assert.equal(original.mtimeNs, BigInt(timestamp) * 1_000_000_000n)
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.html'), 'unchanged sidecar rebuild')
  })
  assert.equal((await stat(output, { bigint: true })).ctimeNs, original.ctimeNs, 'the normalized output was cached, not rewritten')

  await writeFile(output, 'tampered')
  await utimes(output, timestamp, timestamp)
  const modified = await stat(output, { bigint: true })
  assert.equal(modified.size, original.size)
  assert.equal(modified.mtimeNs, original.mtimeNs, 'mtime is restored exactly, not merely within a tolerance')
  assert.equal(modified.ino, original.ino)
  assert.equal(modified.dev, original.dev)
  assert.notEqual(modified.ctimeNs, original.ctimeNs, 'ctime is the changed cache-validation metadata')
  assert.equal(await read('metadata.txt'), 'tampered')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.html'), 'rebuild after external edit')
  })
  assert.equal(await read('metadata.txt'), 'original', 'matching hash, size, inode and mtime cannot hide an external edit')
})

test('watch retains cached writes before iterator failure through another failed worker and recovery', { timeout: 30_000 }, async t => {
  const outputs = `yield { outputName: 'existing.txt', content: 'updated before failure' }
    yield { outputName: 'partial.txt', content: 'new before failure' }`
  const { site, src, dest, read, mtime, logs } = await setup(t, {
    'page.js': `export default () => 'initial main'; export const pageOutputs = () => [
      { outputName: 'existing.txt', content: 'initial sidecar' },
      { outputName: 'stale.txt', content: 'keep until recovery' },
    ]`,
  })
  await site.watch({ serve: false })
  const mainTime = await mtime('index.html')
  const existingTime = await mtime('existing.txt')
  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), `export default () => 'failed main'; export async function* pageOutputs () {
      ${outputs}
      throw Error('first cache iterator failure')
    }`)
  }, 'first cache iterator failure')
  assert.equal(await read('existing.txt'), 'updated before failure')
  assert.equal(await read('partial.txt'), 'new before failure')
  assert.notEqual(await mtime('existing.txt'), existingTime)
  const cachedTimes = [await mtime('existing.txt'), await mtime('partial.txt')]

  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), `export default () => 'failed again'; export async function* pageOutputs () {
      ${outputs}
      throw Error('second cache iterator failure')
    }`)
  }, 'second cache iterator failure')
  assert.deepEqual([await mtime('existing.txt'), await mtime('partial.txt')], cachedTimes, 'failed workers retain both updated and newly created cache entries')
  assert.equal(await read('index.html'), 'initial main')
  assert.equal(await mtime('index.html'), mainTime)
  assert.equal(await read('stale.txt'), 'keep until recovery')

  await settle(site, logs, async () => {
    await writeFile(join(src, 'page.js'), `export default () => 'recovered main'; export async function* pageOutputs () {
      ${outputs}
    }`)
  })
  assert.equal(await read('index.html'), 'recovered main')
  assert.equal(await read('existing.txt'), 'updated before failure')
  assert.equal(await read('partial.txt'), 'new before failure')
  assert.deepEqual([await mtime('existing.txt'), await mtime('partial.txt')], cachedTimes, 'recovery also skips unchanged outputs from failed workers')
  await assert.rejects(stat(join(dest, 'stale.txt')), { code: 'ENOENT' })
})

for (const writer of ['template', 'page']) {
  test(`watch repairs a cached hook destination overwritten by another ${writer}`, { timeout: 20_000 }, async t => {
    const otherSource = writer === 'template' ? 'shared.template.js' : 'shared.md'
    const otherContent = writer === 'template'
      ? "export default () => ({ outputName: 'shared.html', content: 'other writer' })"
      : 'other writer'
    const { site, src, read, mtime, logs } = await setup(t, {
      'page.js': "export default () => 'initial owner'",
      [otherSource]: writer === 'template'
        ? "export default () => ({ outputName: 'shared.html', content: 'initial other writer' })"
        : 'initial other writer',
    })
    await site.watch({ serve: false })
    // Add the hook only after the competing output exists, avoiding concurrent
    // writes to the same destination during the initial build.
    await settle(site, logs, async () => {
      await writeFile(join(src, 'page.js'), "export default () => 'seeded owner'; " + hook('shared.html', 'hook content'))
    })
    assert.equal(await read('shared.html'), 'hook content')
    const ownerTime = await mtime('index.html')
    await settle(site, logs, async () => {
      await writeFile(join(src, otherSource), otherContent)
    })
    if (writer === 'template') {
      assert.equal(await read('shared.html'), 'other writer')
    } else {
      assert.match(await read('shared.html'), /<p>other writer<\/p>/)
    }
    assert.equal(await mtime('index.html'), ownerTime, 'the competing writer rebuild leaves the hook owner untouched')
    await settle(site, logs, async () => {
      await writeFile(join(src, 'page.js'), "export default () => 'repaired owner'; " + hook('shared.html', 'hook content'))
    })
    assert.equal(await read('index.html'), 'repaired owner')
    assert.equal(await read('shared.html'), 'hook content', 'the next hook owner rebuild detects another writer despite unchanged hook bytes')
  })
}
