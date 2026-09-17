/**
 * @import { PageInfo } from '../../identify-pages.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolvePageOutputProvider } from './resolve-page-output-provider.js'

/** @param {PageInfo['type']} [type] @returns {PageInfo} */
function pageInfo (type = 'js') {
  return /** @type {PageInfo} */ ({
    type,
    pageFile: { filepath: '/src/page.js' },
    pageVars: { filepath: '/src/page.vars.js' },
  })
}

const pageHook = () => { throw new Error('page hook must remain lazy') }
const companionHook = () => { throw new Error('companion hook must remain lazy') }

test('JS page providers win with a warning and source provenance', () => {
  const { provider, warning } = resolvePageOutputProvider(pageInfo(), pageHook, { pageOutputs: companionHook })
  assert.equal(provider?.hook, pageHook)
  assert.deepEqual(provider?.provenance, { kind: 'page', source: '/src/page.js' })
  assert.equal(warning?.code, 'DOM_STACK_WARNING_DUPLICATE_PAGE_OUTPUTS_PROVIDER')
  assert.match(warning?.message ?? '', /page.js.*page.vars.js.*ignoring the companion/)
})

test('companions provide JS, HTML and Markdown outputs without warnings', () => {
  for (const type of /** @type {const} */ (['js', 'html', 'md'])) {
    const { provider, warning } = resolvePageOutputProvider(pageInfo(type), undefined, { pageOutputs: companionHook })
    assert.equal(provider?.hook, companionHook)
    assert.deepEqual(provider?.provenance, { kind: 'companion', source: '/src/page.vars.js' })
    assert.equal(warning, undefined)
  }
  assert.deepEqual(resolvePageOutputProvider(pageInfo(), undefined, undefined), {})
  assert.deepEqual(resolvePageOutputProvider(pageInfo('html'), pageHook, undefined), {})
})

test('malformed companion hooks are rejected even when a page provider wins', () => {
  assert.throws(() => resolvePageOutputProvider(pageInfo(), pageHook, { pageOutputs: null }), /pageOutputs.*page.vars.js.*must be a function/)
})

test('generated pages skip provider selection and companion validation', () => {
  const page = pageInfo()
  page.generated = { pagesFile: { pagesFile: page.pageFile, path: '', name: 'generated' }, children: '' }
  assert.deepEqual(resolvePageOutputProvider(page, pageHook, { pageOutputs: null }), {})
})
