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
  const concurrent = Array.from({ length: 24 }, () => resolve('/settings.mjs'))
  assert.ok(concurrent.every(pending => pending === first))
  assert.deepEqual(calls, ['/settings.mjs'])
  ready.resolve(undefined)
  assert.ok((await Promise.all(concurrent)).every(renderer => renderer === md))
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
  const resolve = createMdResolver(async () => {
    if (++calls === 1) throw failure
    return md
  })
  const first = resolve('/settings.mjs')
  const second = resolve('/settings.mjs')
  assert.equal(first, second)
  await assert.rejects(first, error => error === failure)
  assert.equal(await resolve('/settings.mjs'), md)
  assert.equal(await resolve('/settings.mjs'), md)
  assert.equal(calls, 2)
})
