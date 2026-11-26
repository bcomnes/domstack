/** @import { TestContext } from 'node:test' */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs, { access, chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { DomStack } from '../index.js'
import { builder } from './builder.js'
import { claimDestination } from './destination-claim.js'
import { checkCleanupTarget, cleanDest } from './helpers/clean-dest.js'
import { resolveCanonicalPath } from './helpers/path.js'

/** @param {TestContext} t */
async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-clean-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  await mkdir(src)
  await writeFile(join(src, 'page.html'), '<h1>Home</h1>')
  return { root, src, dest }
}

test('full builds remove stale outputs and hidden files while preserving the destination directory', async t => {
  const { src, dest } = await fixture(t)
  const dom = new DomStack(src, dest)
  await mkdir(join(src, 'old'))
  await writeFile(join(src, 'old', 'page.html'), '<h1>Old page</h1>')
  await writeFile(join(src, 'asset.txt'), 'asset')
  await dom.build()
  await chmod(dest, 0o750)
  const before = await stat(dest)
  await writeFile(join(dest, '.hidden'), 'hidden')
  await rm(join(src, 'old'), { recursive: true })
  await rm(join(src, 'asset.txt'))
  await dom.build()
  for (const name of ['old', 'asset.txt', '.hidden']) {
    await assert.rejects(access(join(dest, name)), { code: 'ENOENT' })
  }
  const after = await stat(dest)
  assert.equal(after.ino, before.ino)
  assert.equal(after.mode, before.mode)
  assert.match(await readFile(join(dest, 'index.html'), 'utf8'), /Home/)
})

test('clean: false preserves existing contents while writing current outputs', async t => {
  const { src, dest } = await fixture(t)
  await mkdir(join(dest, 'nested'), { recursive: true })
  await writeFile(join(dest, '.hidden'), 'keep hidden')
  await writeFile(join(dest, 'nested', 'keep.txt'), 'keep nested')
  await writeFile(join(dest, 'index.html'), 'old output')
  await new DomStack(src, dest, { clean: false }).build()
  assert.equal(await readFile(join(dest, '.hidden'), 'utf8'), 'keep hidden')
  assert.equal(await readFile(join(dest, 'nested', 'keep.txt'), 'utf8'), 'keep nested')
  assert.match(await readFile(join(dest, 'index.html'), 'utf8'), /Home/)
})

test('cleanup refuses filesystem roots, normalized root paths and symlink aliases', async t => {
  const { root, src, dest } = await fixture(t)
  const filesystemRoot = parse(root).root
  const alias = join(root, 'root-alias')
  await symlink(filesystemRoot, alias, 'dir')
  // Fail closed even if a future regression removes the root guards.
  t.mock.method(fs, 'readdir', async () => assert.fail('Root cleanup must not read directory entries'))
  t.mock.method(fs, 'rm', async () => assert.fail('Root cleanup must not remove anything'))
  syncBuiltinESMExports()
  try {
    for (const path of [filesystemRoot, `${filesystemRoot}tmp/..`, alias]) {
      await assert.rejects(checkCleanupTarget(src, path, []), /Refusing to clean filesystem root/)
      await assert.rejects(cleanDest(path, path), /Refusing to clean filesystem root/)
    }
    // Either argument resolving to a root must be rejected before directory reads.
    await assert.rejects(cleanDest(dest, filesystemRoot), /Refusing to clean filesystem root/)
    await assert.rejects(new DomStack(src, filesystemRoot).build(), /overlaps the DOMStack lock directory|Refusing to clean filesystem root/)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
  assert.equal(await readFile(join(src, 'page.html'), 'utf8'), '<h1>Home</h1>')
})

test('cleanup refuses protected directories and symlink aliases before deleting anything', async t => {
  const { root, src } = await fixture(t)
  const alias = join(root, 'home-alias')
  await symlink(homedir(), alias, 'dir')
  const targets = [homedir(), tmpdir(), alias]
  if (process.platform !== 'win32') targets.push('/etc', '/usr/local', '/var')
  if (process.platform === 'darwin') targets.push('/Users', '/private/etc')
  const canonicalTargets = await Promise.all(targets.map(resolveCanonicalPath))
  t.mock.method(fs, 'readdir', async () => assert.fail('Protected cleanup must not read directory entries'))
  t.mock.method(fs, 'rm', async () => assert.fail('Protected cleanup must not remove anything'))
  syncBuiltinESMExports()
  try {
    for (const [index, canonical] of canonicalTargets.entries()) {
      const destination = targets[index]
      assert.ok(destination)
      await assert.rejects(checkCleanupTarget(src, destination, []), /Refusing to clean protected directory/)
      await assert.rejects(cleanDest(destination, canonical), /Refusing to clean protected directory/)
    }
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})

test('cleanup unlinks child symlinks and preserves a symlink destination', async t => {
  const { root, src, dest } = await fixture(t)
  const outside = join(root, 'outside')
  const alias = join(root, 'alias')
  await mkdir(outside)
  await writeFile(join(outside, 'keep.txt'), 'keep')
  await mkdir(dest)
  await symlink(outside, join(dest, 'linked'), 'dir')
  await symlink(dest, alias, 'dir')
  await new DomStack(src, alias).build()
  assert.ok((await lstat(alias)).isSymbolicLink())
  await assert.rejects(lstat(join(dest, 'linked')), { code: 'ENOENT' })
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep')
  await access(join(dest, 'index.html'))
})

test('nested destinations inside the source still build cleanly', async t => {
  const { src } = await fixture(t)
  const dest = join(src, 'public')
  const dom = new DomStack(src, dest)
  await dom.build()
  await writeFile(join(dest, 'stale.txt'), 'stale')
  await dom.build()
  await assert.rejects(access(join(dest, 'stale.txt')), { code: 'ENOENT' })
  await access(join(dest, 'index.html'))
  await assert.rejects(access(join(dest, 'public')), { code: 'ENOENT' })
})

test('unsafe destinations preserve source files, including symlink aliases', async t => {
  const { root, src } = await fixture(t)
  const alias = join(root, 'alias')
  await symlink(src, alias, 'dir')
  for (const dest of [src, root, alias]) {
    await assert.rejects(new DomStack(src, dest).build(), /Refusing to clean unsafe build destination/)
    assert.equal(await readFile(join(src, 'page.html'), 'utf8'), '<h1>Home</h1>')
  }
  await assert.rejects(checkCleanupTarget(src, await resolveCanonicalPath(process.cwd()), []), /unsafe build destination/)
})

test('cleanup rejects copy inputs inside the destination through symlink aliases', async t => {
  const { root, src, dest } = await fixture(t)
  const input = join(dest, 'input')
  const alias = join(root, 'copy-alias')
  await mkdir(input, { recursive: true })
  await writeFile(join(input, 'keep.txt'), 'keep')
  await symlink(input, alias, 'dir')
  await assert.rejects(new DomStack(src, dest, { copy: [alias] }).build(), /unsafe build destination/)
  assert.equal(await readFile(join(input, 'keep.txt'), 'utf8'), 'keep')
})

test('an existing destination claim prevents cleanup', async t => {
  const { src, dest } = await fixture(t)
  await mkdir(dest)
  await writeFile(join(dest, 'keep.txt'), 'keep')
  const claim = await claimDestination(dest)
  try {
    await assert.rejects(new DomStack(src, dest).build(), { code: 'DOMSTACK_DESTINATION_IN_USE' })
    assert.equal(await readFile(join(dest, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    await claim.release()
  }
  await new DomStack(src, dest).build()
  await assert.rejects(access(join(dest, 'keep.txt')), { code: 'ENOENT' })
})

test('cleanup refuses a destination alias changed after claiming', async t => {
  const { root, src, dest } = await fixture(t)
  const other = join(root, 'other')
  await mkdir(dest)
  await mkdir(other)
  await writeFile(join(other, 'keep.txt'), 'keep')
  const canonical = await resolveCanonicalPath(dest)
  await rm(dest, { recursive: true })
  await symlink(other, dest, 'dir')
  await assert.rejects(cleanDest(dest, canonical), /destination changed/)
  assert.equal(await readFile(join(other, 'keep.txt'), 'utf8'), 'keep')
  // A failed cleanup releases the builder's claim as well.
  await assert.rejects(builder(src, dest, {}, async () => {
    await rm(dest)
    await mkdir(dest)
  }), /destination changed/)
  await new DomStack(src, dest).build()
})
