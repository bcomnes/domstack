import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { setup } from '../outputs/test-helpers.js'
import { builder } from '../../builder.js'

for (const extension of ['js', 'md', 'html']) {
  test(`${extension} composition filename skips automatic renderers and hooks but retains initialized metadata`, async t => {
    const { build, read, dest } = await setup(t, {
      'root.layout.js': `export default ({ children, page }) => {
        if (page.compose) throw Error('composition layout must not run automatically')
        return children
      }
      export const pageOutputs = ({ page }) => {
        if (page.compose) throw Error('composition layout hook must not run')
        return []
      }`,
      [`fragment/page.compose.${extension}`]: extension === 'js'
        ? `export default () => { throw Error('automatic composition renderer ran') }
           export const pageOutputs = () => { throw Error('automatic composition hook ran') }`
        : '# Fragment',
      'global.data.js': `export default ({ pages }) => ({
        info: pages.map(page => [page.pageInfo.path, page.pageInfo.compose]).sort(),
      })`,
      'page.js': `export const vars = { dataDeps: ['info'] }
        export default ({ data, page }) => JSON.stringify({ info: data.info, compose: page.compose })`,
    })
    const result = await build()
    assert.deepEqual(JSON.parse(await read('index.html')), { info: [['', false], ['fragment', true]], compose: false })
    await assert.rejects(stat(join(dest, 'fragment/index.html')), { code: 'ENOENT' })
    assert.deepEqual(result.pageBuildResults?.outputs.map(output => output.outputRelname), ['index.html'])
  })
}

test('composition metadata does not inherit from or get overridden by ordinary vars', async t => {
  const { build, read, dest } = await setup(t, {
    'global.vars.js': "export default { layout: 'root', compose: true, emit: false }",
    'root.layout.js': `export const vars = { compose: false, emit: 'ordinary data' }
      export default ({ children }) => children`,
    'fragment/page.compose.js': `export const vars = { compose: false, emit: true }
      export default () => { throw Error('ordinary vars must not turn on composition output') }`,
    'page.js': `export const vars = { compose: true, emit: null }
      export default ({ page }) => String(page.compose)`,
  })
  await build()
  assert.equal(await read('index.html'), 'false')
  await assert.rejects(stat(join(dest, 'fragment/index.html')), { code: 'ENOENT' })
})

for (const buildDrafts of [false, true]) {
  test(`draft inclusion does not override composition filenames (buildDrafts=${buildDrafts})`, async t => {
    const { src, dest } = await setup(t, {
      'page.md': '# Home',
      'fragment/page.compose.draft.md': '# Draft fragment',
      'global.data.js': `export default ({ pages }) => {
        const fragment = pages.find(page => page.pageInfo.path === 'fragment')
        if (${buildDrafts} && (!fragment || !fragment.pageInfo.compose || !fragment.pageInfo.draft)) {
          throw Error('draft composition metadata missing')
        }
        if (!${buildDrafts} && fragment) throw Error('draft must remain excluded')
        return {}
      }`,
    })
    await builder(src, dest, { buildDrafts, static: false })
    await assert.rejects(stat(join(dest, 'fragment/index.html')), { code: 'ENOENT' })
  })
}

test('generated composition definitions do not reserve nonexistent output', async t => {
  const { build, read } = await setup(t, {
    'shared/page.compose.md': '# Source fragment',
    'article.pages.js': `export default [
      { outputName: 'shared/index.html', compose: true, children: () => { throw Error('generated composition renderer ran') } },
      { outputName: 'shared/index.html', children: ({ page }) => 'Generated: ' + page.compose },
    ]`,
  })
  const result = await build()
  assert.equal(await read('shared/index.html'), 'Generated: false')
  assert.deepEqual(result.pageBuildResults?.outputs.map(output => output.outputRelname), ['shared/index.html'])
})
