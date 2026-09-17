import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveLayoutName } from './resolve-layout-name.js'

test('selects builder, companion, then global layout without merging unrelated vars', () => {
  const globalVars = { layout: 'global' }
  const pageVars = { layout: 'companion' }
  const builderVars = {
    layout: 'builder',
    get title () { throw new Error('Unrelated vars must not be read') },
  }
  assert.equal(resolveLayoutName(globalVars, pageVars, builderVars), 'builder')
  assert.equal(resolveLayoutName(globalVars, pageVars, {}), 'companion')
  assert.equal(resolveLayoutName(globalVars, null, null), 'global')
})

test('rejects missing or invalid selected layouts instead of falling back', () => {
  assert.throws(() => resolveLayoutName({}, null, null), /Page variables missing a layout var/)
  assert.throws(() => resolveLayoutName({ layout: 'global' }, { layout: undefined }, null), /Layout variable must be a string/)
  assert.throws(() => resolveLayoutName({ layout: 'global' }, null, { layout: false }), /Layout variable must be a string/)
})
