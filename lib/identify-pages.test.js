import { test } from 'node:test'
import assert from 'node:assert'
import { resolve } from 'path'

import { identifyPages } from './identify-pages.js'

const __dirname = import.meta.dirname

test.describe('identify-pages', () => {
  test('identifyPages works as expected', async () => {
    const results = await identifyPages(resolve(__dirname, '../test-cases/general-features/src'))
    // console.log(results)
    assert.ok(results.globalStyle, 'Global style is found')
    assert.ok(results.globalVars, 'Global variabls are found')
    assert.ok(results.layouts, 'Layouts are found')

    assert.ok(results.layouts['root'], 'A root layouts is found')
    assert.equal(Object.keys(results.pages).length, 27, '27 pages are found')

    assert.equal(results.warnings.length, 1, '1 warning produced')
    assert.equal(results.warnings[0].code, 'DOM_STACK_WARNING_PAGE_MD_SHADOWS_README', 'page.md shadows README.md warning is produced')
    // assert.equal(results.nonPageFolders.length, 4, '4 non-page-folder')
    assert.equal(results.pages.find(p => p.path === 'html-page')?.pageFile?.type, 'html', 'html page is type html')
    assert.equal(results.pages.find(p => p.path === 'md-page')?.pageFile?.type, 'md', 'md page is type md')
    assert.equal(results.pages.find(p => p.path === 'js-page')?.pageFile?.type, 'js', 'js-page is type js')
    assert.equal(results.pages.find(p => p.path === 'page-md-page')?.pageFile?.type, 'md', 'page-md-page is type md')
    assert.equal(results.pages.find(p => p.path === 'page-md-page')?.pageFile?.basename, 'page.md', 'page-md-page uses page.md')
    assert.equal(results.pages.find(p => p.path === 'page-md-precedence')?.pageFile?.basename, 'page.md', 'page.md takes precedence over README.md')
  })
})
