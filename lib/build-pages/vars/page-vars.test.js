/**
 * @import { PageVarSources } from './page-vars.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PageVars } from './page-vars.js'

/** @returns {PageVarSources<Record<string, unknown>>} */
function sources () {
  return { globalVars: { title: 'global' }, layoutVars: [], pageVars: null, builderVars: null }
}

test('an uncached initialization merge does not establish the first-access snapshot', () => {
  const page = sources()
  const vars = new PageVars()
  assert.deepEqual(vars.mergeUncached(page), { title: 'global' })
  page.globalVars['title'] = 'before first access'
  const snapshot = vars.getCached(page)
  assert.equal(snapshot['title'], 'before first access')
  page.globalVars['title'] = 'after first access'
  assert.equal(vars.getCached(page), snapshot)
  assert.equal(vars.mergeUncached(page)['title'], 'after first access')
  assert.equal(vars.getCached(page), snapshot, 'uncached merges do not replace an existing snapshot')
})

test('cache hits compare source identities without enumerating or collecting sources', () => {
  const page = sources()
  let reads = 0
  page.globalVars = { get title () { reads++; return 'global' } }
  page.layoutVars = [{ vars: { title: 'layout' } }]
  const vars = new PageVars()
  const snapshot = vars.getCached(page)
  page.layoutVars[Symbol.iterator] = () => { throw new Error('Cache hits must not collect sources') }
  for (let index = 0; index < 10; index++) assert.equal(vars.getCached(page), snapshot)
  assert.equal(reads, 1)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(snapshot['title'], 'layout')
})

test('failed merges preserve the previous snapshot and can be retried', () => {
  const page = sources()
  const vars = new PageVars()
  const first = vars.getCached(page)
  const original = page.globalVars
  const cause = new Error('Failed getter')
  page.globalVars = { get title () { throw cause } }
  assert.throws(() => vars.getCached(page), error => error === cause)
  assert.throws(() => vars.getCached(page), error => error === cause)
  page.globalVars = original
  assert.equal(vars.getCached(page), first)
  page.globalVars = { title: 'recovered' }
  assert.equal(vars.getCached(page)['title'], 'recovered')
})
