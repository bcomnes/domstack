/** @import { TestContext } from 'node:test' */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { claimDestination } from './destination-claim.js'

/** @param {TestContext} t */
async function fixture (t) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-claim-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'locks')
  const dest = join(root, 'dist')
  return { root, directory, dest }
}

const conflict = { code: 'DOMSTACK_DESTINATION_IN_USE' }

test('claims block identical and nested destinations in both orders, but not siblings', async t => {
  const { root, directory, dest } = await fixture(t)
  const nested = join(dest, 'docs')
  const orders = /** @type {const} */ ([[dest, nested], [nested, dest]])
  for (const [first, blocked] of orders) {
    const owner = await claimDestination(first, directory)
    try {
      await assert.rejects(claimDestination(first, directory), conflict)
      await assert.rejects(claimDestination(blocked, directory), conflict)
      const peer = await claimDestination(join(root, 'dist-old'), directory)
      await peer.release()
      if (first === nested) {
        const sibling = await claimDestination(join(dest, 'blog'), directory)
        await sibling.release()
      }
      await assert.rejects(access(dest), { code: 'ENOENT' })
    } finally {
      await owner.release()
    }
  }
})

test('claims resolve aliases before creating a missing destination', async t => {
  const { root, directory, dest } = await fixture(t)
  const alias = join(root, 'alias')
  await symlink(root, alias, 'junction')
  const owner = await claimDestination(join(alias, 'dist'), directory)
  try {
    assert.equal(owner.destination, join(await realpath(root), 'dist'))
    await mkdir(dest)
    await assert.rejects(claimDestination(dest, directory), conflict)
  } finally {
    await owner.release()
  }
})

test('a paused process retains its claim and a killed process releases it', { timeout: 10000, skip: process.platform === 'win32' }, async t => {
  const { directory, dest } = await fixture(t)
  const moduleUrl = new URL('./destination-claim.js', import.meta.url).href
  const script = `
    import { claimDestination } from ${JSON.stringify(moduleUrl)}
    const claim = await claimDestination(process.argv[1], process.argv[2])
    setInterval(() => { if (!claim.destination) throw new Error('lost claim') }, 1000)
    process.send('claimed')
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, dest, directory], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  const exited = once(child, 'exit')
  try {
    await Promise.race([
      once(child, 'message'),
      exited.then(() => { throw new Error('Claim holder exited before reporting readiness') }),
    ])
    assert.equal(child.kill('SIGSTOP'), true)
    await assert.rejects(claimDestination(dest, directory), conflict)
  } finally {
    child.kill('SIGKILL')
    await exited
  }
  const successor = await claimDestination(dest, directory)
  await successor.release()
})
