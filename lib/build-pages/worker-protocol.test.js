/**
 * @import { PageInfo, PagesFileInfo, TemplateInfo, WalkerFile } from '../identify-pages.js'
 * @import { WorkerErrorData } from './worker-protocol.js'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { posix } from 'node:path'
import * as facade from './index.js'
import { buildPagesDirect } from './build.js'
import { pageBuilders } from './page-builders/index.js'
import { pageInfoForWorker, restoreWorkerError, serializeBuildError } from './worker-protocol.js'
import { DomStackDataError, DomStackOutputConflictError } from '../helpers/domstack-error.js'

/** @param {string} relname @returns {WalkerFile} */
function file (relname) {
  return {
    root: '/src',
    filepath: `/src/${relname}`,
    relname,
    basename: posix.basename(relname),
    parentName: posix.dirname(relname) === '.' ? '' : posix.dirname(relname),
  }
}

/** @type {PageInfo} */
const page = {
  pageFile: { ...file('blog/page.js'), type: 'js' },
  type: 'js',
  path: 'blog',
  url: '/blog/',
  outputName: 'index.html',
  outputRelname: 'blog/index.html',
  draft: false,
}

/** @type {TemplateInfo} */
const template = {
  templateFile: file('feeds/rss.template.js'),
  path: 'feeds',
  outputName: 'rss.xml',
}

/** @type {PagesFileInfo} */
const pagesFile = {
  pagesFile: file('blog/posts.pages.js'),
  path: 'blog',
  name: 'posts',
}

/**
 * @param {unknown} error
 * @param {WorkerErrorData} [context]
 * @param {string} [message]
 */
function roundTrip (error, context, message) {
  const cloned = structuredClone(serializeBuildError(error, context, message))
  return restoreWorkerError(cloned.error, cloned.errorData ?? {})
}

test('build-pages facade preserves runtime export identity after the split', () => {
  assert.equal(facade.buildPagesDirect, buildPagesDirect)
  assert.equal(facade.serializeBuildError, serializeBuildError)
  assert.equal(facade.pageBuilders, pageBuilders)
})

test('data errors retain their class, metadata, cause, stack and page context across cloning', () => {
  const original = new DomStackDataError('Missing global data key "posts"', {
    reason: 'MISSING_KEY',
    consumer: 'Page "blog/page.js"',
    key: 'posts',
  }, { cause: new Error('Global data failed') })
  const context = { page }
  const restored = roundTrip(original, context, 'Generic page build failure')

  assert.ok(restored instanceof DomStackDataError)
  assert.equal(restored.name, 'DomStackDataError')
  assert.equal(restored.code, 'DOM_STACK_ERROR_DATA')
  assert.deepEqual(restored.dataDependency, original.dataDependency)
  assert.notEqual(restored.dataDependency, original.dataDependency)
  assert.equal(restored.message, 'Missing global data key "posts" (page: "blog")')
  assert.ok('page' in restored)
  assert.deepEqual(restored.page, page)
  assert.notEqual(restored.page, page)
  assert.deepEqual(restored.cause, original.cause)
  assert.ok(original.stack)
  assert.equal(restored.stack, original.stack.replace(original.message, restored.message))
  assert.deepEqual(context, { page })
  assert.equal(original.message, 'Missing global data key "posts"')
})

test('output conflicts retain both claims, code, cause and pages-file context across cloning', () => {
  const original = new DomStackOutputConflictError('Output path conflict: blog/index.html', {
    outputPath: 'blog/index.html',
    a: { type: 'page', path: 'blog/page.js' },
    b: { type: 'page', path: 'blog/posts.pages.js#0' },
  }, { cause: new Error('Output already claimed') })
  const restored = roundTrip(original, { pagesFile }, 'Generic factory failure')

  assert.ok('code' in restored)
  assert.equal(restored.code, 'DOM_STACK_ERROR_OUTPUT_CONFLICT')
  assert.ok('conflict' in restored)
  assert.deepEqual(restored.conflict, original.conflict)
  assert.notEqual(restored.conflict, original.conflict)
  assert.ok('pagesFile' in restored)
  assert.deepEqual(restored.pagesFile, pagesFile)
  assert.equal(restored.message, 'Output path conflict: blog/index.html (pages file: "blog/posts.pages.js")')
  assert.deepEqual(restored.cause, original.cause)
  assert.ok(original.stack)
  assert.equal(restored.stack, original.stack.replace(original.message, restored.message))
})

/** @type {{ name: string, context: WorkerErrorData, suffix: string }[]} */
const contextualCases = [
  { name: 'page path takes precedence', context: { page, template, pagesFile }, suffix: ' (page: "blog")' },
  { name: 'page URL fallback', context: { page: { ...page, path: '' } }, suffix: ' (page: "/blog/")' },
  { name: 'page filename fallback', context: { page: { ...page, path: '', url: '' } }, suffix: ' (page: "blog/page.js")' },
  { name: 'template path takes precedence', context: { template, pagesFile }, suffix: ' (template: "feeds")' },
  { name: 'template filename fallback', context: { template: { ...template, path: '' } }, suffix: ' (template: "feeds/rss.template.js")' },
  { name: 'pages-file filename', context: { pagesFile }, suffix: ' (pages file: "blog/posts.pages.js")' },
  { name: 'no context', context: {}, suffix: '' },
]

for (const { name, context, suffix } of contextualCases) {
  test(`ordinary errors survive cloning with ${name}`, () => {
    const original = new TypeError('Render failed', { cause: new Error('Invalid value') })
    const restored = roundTrip(original, context)

    assert.equal(restored.name, 'TypeError')
    assert.equal(restored.message, `Render failed${suffix}`)
    assert.deepEqual(restored.cause, original.cause)
    assert.ok(original.stack)
    assert.equal(restored.stack, original.stack.replace(original.message, restored.message))
    for (const [key, value] of Object.entries(context)) {
      assert.deepEqual(Reflect.get(restored, key), value)
    }
    assert.equal('code' in restored, false)
  })
}

test('ordinary error wrappers retain the original message and stack as their cause', () => {
  const original = new Error('Invalid template output')
  const restored = roundTrip(original, { template }, 'Template build failed')

  assert.equal(restored.message, 'Template build failed (template: "feeds")')
  assert.deepEqual(restored.cause, { message: original.message, stack: original.stack })
  assert.ok('template' in restored)
  assert.deepEqual(restored.template, template)
  assert.equal(original.message, 'Invalid template output')
})

test('generated page context is sanitized and cloneable without mutating the input', () => {
  const vars = Object.freeze({ title: 'Generated post', format: () => 'formatted' })
  const children = () => 'Rendered post'
  const generated = Object.freeze({ pagesFile, vars, children })
  /** @type {PageInfo} */
  const original = Object.freeze({
    ...page,
    pageFile: {
      ...pagesFile.pagesFile,
      basename: 'posts.pages.js#0',
      relname: 'blog/posts.pages.js#0',
      type: /** @type {const} */ ('js'),
    },
    generated,
  })

  assert.throws(() => structuredClone(original), { name: 'DataCloneError' })
  const sanitized = pageInfoForWorker(original)
  assert.notEqual(sanitized, original)
  assert.notEqual(sanitized.generated, generated)
  assert.deepEqual(sanitized, { ...original, generated: { pagesFile } })
  assert.deepEqual(structuredClone(sanitized), sanitized)

  const restored = roundTrip(new Error('Generated render failed'), { page: sanitized })
  assert.ok('page' in restored)
  assert.deepEqual(restored.page, sanitized)
  assert.equal(restored.message, 'Generated render failed (page: "blog")')
  assert.equal(original.generated, generated)
  assert.equal(original.generated.vars, vars)
  assert.equal(original.generated.children, children)
  assert.deepEqual(original.generated, { pagesFile, vars, children })
})

test('concrete page context is returned unchanged', () => {
  assert.equal(pageInfoForWorker(page), page)
  assert.deepEqual(structuredClone(pageInfoForWorker(page)), page)
})
