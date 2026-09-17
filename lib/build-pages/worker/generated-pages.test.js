import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DomStack } from '../../../index.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withTempFixture, minimalRootLayout, minimalGlobalVars, firstGeneratedPagesError } from '../generated-pages/test-helpers.js'

import { DomStackDataError } from '../../helpers/domstack-error.js'

test('subscription errors preserve their subtype and metadata across the worker boundary', async t => {
  const cases = [
    { name: 'page declaration', reason: 'INVALID_DECLARATION', consumer: 'Page "page.js"', files: { 'page.js': "export const vars = { dataDeps: 'value' }; export default () => ''" } },
    { name: 'missing page key', reason: 'MISSING_KEY', consumer: 'Page "page.js"', key: 'missing', files: { 'page.js': "export const vars = { dataDeps: ['missing'] }; export default () => ''" } },
    { name: 'undeclared page access', reason: 'UNDECLARED_KEY', consumer: 'Page "page.js"', key: 'value', files: { 'page.js': 'export default ({data}) => data.value' } },
    { name: 'undeclared layout access', reason: 'UNDECLARED_KEY', consumer: 'Layout "root"', key: 'value', files: { 'page.html': 'Page', 'root.layout.js': 'export default ({data}) => data.value' } },
    { name: 'undeclared template access', reason: 'UNDECLARED_KEY', consumer: 'Template "value.template.js"', key: 'value', files: { 'value.template.js': 'export default ({data}) => data.value' } },
    { name: 'missing factory key', reason: 'MISSING_KEY', consumer: 'Pages file "value.pages.js"', key: 'missing', files: { 'value.pages.js': "export const dataDeps = ['missing']; export default () => []" } },
    { name: 'generated declaration', reason: 'INVALID_DECLARATION', consumer: 'Page "value.pages.js#0"', files: { 'value.pages.js': 'export default { vars: { dataDeps: false } }' } },
    { name: 'data dependency cycle', reason: 'NOT_READY', consumer: 'Page "page.js"', files: { 'page.js': "export const vars = { dataDeps: ['value'] }; export default ({data}) => data.value", 'global.data.js': 'export default async ({pages}) => ({ value: await pages[0].renderInnerPage() })' } },
    { name: 'global vars declaration', reason: 'INVALID_DECLARATION', consumer: 'Global vars', files: { 'global.vars.js': "export default { layout: 'root', dataDeps: ['value'] }" } },
  ]
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      await withTempFixture({
        'root.layout.js': minimalRootLayout,
        'global.vars.js': minimalGlobalVars,
        'global.data.js': "export default { value: 'hello' }",
        ...scenario.files,
      }, async ({ src, dest }) => {
        await assert.rejects(new DomStack(src, dest).build(), error => {
          assert.ok(error instanceof AggregateError)
          const dataError = error.errors.find(err => err instanceof DomStackDataError)
          assert.ok(dataError, 'a DomStackDataError survives worker transport')
          assert.equal(dataError.code, 'DOM_STACK_ERROR_DATA')
          assert.deepEqual(dataError.dataDependency, {
            reason: scenario.reason,
            consumer: scenario.consumer,
            ...(scenario.key === undefined ? {} : { key: scenario.key }),
          })
          return true
        })
      })
    })
  }
})

test('returns copyable generated vars derived from serializable global data', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'global.data.js': `export default function globalData ({ pages }) {
  return { posts: pages.map(page => ({ title: page.vars.title, url: page.pageInfo.url })) }
}
`,
    'README.md': '# Concrete page\n',
    'indexes.pages.js': `export const dataDeps = ['posts']
export default function indexesPages ({ data }) {
  return {
    outputName: 'generated-index/index.html',
    vars: {
      title: 'Generated index',
      posts: data.posts,
    },
    children: ({ vars }) => \`<p id="post-count">\${vars.posts.length}</p>\`,
  }
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    const results = await domstack.build()
    const output = await readFile(join(dest, 'generated-index/index.html'), 'utf8')
    const outputRecord = results.pageBuildResults?.outputs.find(output => output.outputRelname === 'generated-index/index.html')

    assert.match(output, /<p id="post-count">1<\/p>/, 'generated page renders with declared global data')
    assert.ok(outputRecord, 'generated page emits an output record')
    assert.equal(outputRecord.pageVars?.['title'], 'Generated index', 'copyable page vars are returned')
    assert.equal(/** @type {unknown[]} */ (outputRecord.pageVars?.['posts']).length, 1, 'serializable derived data remains available in generated page vars')
  })
})

test('returns generated render errors without sending render state', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'broken.pages.js': `export default {
  outputName: 'broken/index.html',
  children () {
    throw new Error('generated boom', { cause: () => {} })
  },
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    await assert.rejects(
      () => domstack.build(),
      error => {
        const aggregate = /** @type {Error & { errors?: Array<Error & { page?: { path?: string, generated?: { pagesFile?: { pagesFile?: { relname?: string } } } } }> }} */ (error)
        const generatedError = aggregate.errors?.find(error => error.page?.generated)

        assert.ok(generatedError, 'build includes the generated page error')
        assert.match(generatedError.message, /page: "broken"/)
        assert.equal(generatedError.page?.generated?.pagesFile?.pagesFile?.relname, 'broken.pages.js')
        assert.notEqual(generatedError.name, 'DataCloneError')
        assert.equal(/** @type {{ message?: string } | undefined} */ (generatedError.cause)?.message, 'generated boom')
        return true
      }
    )
  })
})

test('returns pages-file context when a generated-pages function throws', async () => {
  await withTempFixture({
    'root.layout.js': minimalRootLayout,
    'global.vars.js': minimalGlobalVars,
    'broken.pages.js': `export default function () {
  throw new Error('pages factory boom', { cause: () => {} })
}
`,
  }, async ({ src, dest }) => {
    const domstack = new DomStack(src, dest)
    await assert.rejects(
      () => domstack.build(),
      error => {
        const generatedError = firstGeneratedPagesError(error)

        assert.match(generatedError.message, /pages factory boom/)
        assert.match(generatedError.message, /pages file: "broken\.pages\.js"/)
        assert.equal(generatedError.pagesFile?.pagesFile.relname, 'broken.pages.js')
        assert.notEqual(generatedError.name, 'DataCloneError')
        assert.equal(/** @type {{ message?: string } | undefined} */ (generatedError.cause)?.message, 'pages factory boom')
        return true
      }
    )
  })
})
