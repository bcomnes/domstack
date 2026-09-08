import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFile, createFileConventions, isProcessedFile } from './file-conventions.js'
import { getCopyGlob } from './build-static/index.js'

test('server extensions follow runtime support while browser clients always support JSX and TypeScript', () => {
  const withTypes = createFileConventions(true)
  const withoutTypes = createFileConventions(false)
  assert.deepEqual(withTypes.page.names, ['page.ts', 'page.mts', 'page.cts', 'page.js', 'page.mjs', 'page.cjs'])
  assert.deepEqual(withoutTypes.page.names, ['page.js', 'page.mjs', 'page.cjs'])
  assert.deepEqual(withTypes.page.draftNames, withTypes.page.names.map(name => name.replace('page.', 'page.draft.')))
  assert.equal(classifyFile('page.ts', withoutTypes), undefined)
  assert.equal(classifyFile('counter.worker.mts', withoutTypes), undefined)
  assert.equal(classifyFile('service-worker.ts', withoutTypes), undefined)
  for (const extension of ['tsx', 'ts', 'mts', 'cts', 'jsx', 'js', 'mjs', 'cjs']) {
    assert.equal(classifyFile(`client.${extension}`, withoutTypes)?.bundleScope, 'page')
    assert.equal(classifyFile(`root.layout.client.${extension}`, withoutTypes)?.bundleScope, 'layout')
    assert.equal(classifyFile(`global.client.${extension}`, withoutTypes)?.bundleScope, 'global')
  }
})

test('file roles distinguish structural settings, output owners, and asset scopes', () => {
  const cases = [
    ['page.draft.html', 'page', null],
    ['README.draft.md', 'page', null],
    ['root.layout.js', 'layout', null],
    ['archive.pages.js', 'pages-file', null],
    ['feed.template.js', 'template', null],
    ['global.vars.js', 'full', null],
    ['global.data.js', 'pages', null],
    ['esbuild.settings.js', 'full', null],
    ['markdown-it.settings.js', 'markdown', null],
    ['domstack-manifest.settings.js', 'manifest', null],
    ['style.css', 'bundle', 'page'],
    ['counter.worker.js', 'bundle', 'page'],
    ['root.layout.css', 'bundle', 'layout'],
    ['global.style.css', 'bundle', 'global'],
    ['service-worker.js', 'bundle', 'service-worker'],
  ]
  for (const [name, change, scope] of cases) {
    assert.equal(typeof name, 'string')
    const rule = classifyFile(/** @type {string} */ (name))
    assert.equal(rule?.change, change, name ?? '')
    assert.equal(rule?.bundleScope, scope, name ?? '')
  }
  assert.equal(classifyFile('arbitrary.js'), undefined)
  assert.equal(classifyFile('style.css.map'), undefined)
})

test('all convention entries are observed and excluded from static copying', () => {
  const glob = getCopyGlob('/site')
  for (const rule of Object.values(createFileConventions(true))) {
    for (const name of [...rule.names, ...rule.draftNames, ...rule.suffixes.map(suffix => `example${suffix}`)]) {
      assert.equal(isProcessedFile(name), true, name)
      assert.ok(glob.includes(`*.${name.split('.').at(-1)}`), name)
    }
  }
  assert.equal(isProcessedFile('client.tsx'), true)
  assert.equal(isProcessedFile('client.jsx'), true)
  assert.equal(isProcessedFile('image.png'), false)
  assert.equal(isProcessedFile('client.js.map'), false)
})
