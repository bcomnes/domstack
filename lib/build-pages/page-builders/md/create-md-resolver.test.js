/** @import { getMd } from './get-md.js' */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import markdownIt from 'markdown-it'
import { createMdResolver } from './create-md-resolver.js'

test('a build shares pending and resolved renderers by settings identity', async () => {
  const ready = Promise.withResolvers()
  const md = markdownIt()
  /** @type {(string | null | undefined)[]} */
  const calls = []
  const resolve = createMdResolver(async path => {
    calls.push(path)
    await ready.promise
    return md
  })
  const first = resolve('/settings.mjs')
  const second = resolve('/settings.mjs')
  assert.deepEqual(calls, ['/settings.mjs'])
  ready.resolve(undefined)
  for (const renderer of await Promise.all([first, second])) assert.equal(renderer, md)
  assert.equal(await resolve('/settings.mjs'), md)
  assert.equal(calls.length, 1)
})

test('settings identities and builds have independent renderer instances', async () => {
  /** @type {(string | null | undefined)[]} */
  const calls = []
  /** @type {typeof getMd} */
  const load = async path => {
    calls.push(path)
    return markdownIt()
  }
  const firstBuild = createMdResolver(load)
  const defaults = await firstBuild()
  assert.equal(await firstBuild(null), defaults)
  assert.equal(await firstBuild(''), defaults)
  const first = await firstBuild('/first.mjs')
  const second = await firstBuild('/second.mjs')
  assert.notEqual(first, second)
  assert.notEqual(first, defaults)
  const nextBuild = createMdResolver(load)
  assert.notEqual(await nextBuild('/first.mjs'), first)
  assert.deepEqual(calls, [null, '/first.mjs', '/second.mjs', '/first.mjs'])
})

test('rejected initialization is shared but evicted for a later retry', async () => {
  const failure = new Error('initialization failed')
  let calls = 0
  const md = markdownIt()
  const ready = Promise.withResolvers()
  const resolve = createMdResolver(async () => {
    if (++calls === 1) {
      await ready.promise
      throw failure
    }
    return md
  })
  const first = resolve('/settings.mjs')
  const second = resolve('/settings.mjs')
  assert.equal(calls, 1, 'pending callers share the initialization attempt')
  const rejected = [first, second].map(pending => assert.rejects(pending, error => error === failure))
  ready.resolve(undefined)
  await Promise.all(rejected)
  assert.equal(await resolve('/settings.mjs'), md)
  assert.equal(await resolve('/settings.mjs'), md)
  assert.equal(calls, 2)
})
