/**
 * @import { TestContext } from 'node:test'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolvePageCompanion } from './resolve-page-companion.js'

/** @param {TestContext} t @param {string} source */
async function companion (t, source) {
  const dir = await mkdtemp(join(tmpdir(), 'domstack-companion-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'page.vars.mjs')
  await writeFile(path, source)
  return path
}

test('missing companions resolve to empty vars without exports', async () => {
  assert.deepEqual(await resolvePageCompanion(undefined), { vars: {}, exports: undefined })
})

test('companions resolve object and async function vars without validating output hooks', async t => {
  for (const value of ["{ title: 'page' }", "async () => ({ title: 'page' })"]) {
    const path = await companion(t, `export default ${value}; export const pageOutputs = 123`)
    const result = await resolvePageCompanion(path)
    assert.deepEqual(result.vars, { title: 'page' })
    assert.equal(result.exports?.['pageOutputs'], 123)
  }
})

test('vars errors precede obsolete postVars errors, and only truthy postVars is rejected', async t => {
  const invalidVars = await companion(t, 'export default () => null; export const postVars = true')
  await assert.rejects(resolvePageCompanion(invalidVars), /Var function must resolve to a plain object/)
  const obsolete = await companion(t, 'export default {}; export const postVars = () => {}')
  await assert.rejects(resolvePageCompanion(obsolete), error => {
    assert.ok(error instanceof Error)
    assert.ok(error.message.includes(`postVars is no longer supported (found in ${obsolete})`))
    return true
  })
  const falsy = await companion(t, 'export default {}; export const postVars = false')
  assert.deepEqual((await resolvePageCompanion(falsy)).vars, {})
})

test('companion exports stay live after vars resolution without invoking output hooks', async t => {
  const path = await companion(t, `
    export let pageOutputs = () => { throw new Error('must stay lazy') }
    export default () => ({ title: 'page' })
    export function replaceHook () { pageOutputs = () => [] }
  `)
  const result = await resolvePageCompanion(path)
  const exports = await import(path)
  assert.equal(result.exports, exports)
  const original = result.exports?.['pageOutputs']
  exports.replaceHook()
  assert.notEqual(result.exports?.['pageOutputs'], original)
  assert.equal(result.exports?.['pageOutputs'], exports.pageOutputs)
})
