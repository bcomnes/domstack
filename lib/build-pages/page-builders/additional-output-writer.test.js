/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { PageData } from '../page-data.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveAdditionalOutputPath, writeAdditionalOutputs } from './additional-output-writer.js'
import { pageWriter } from './page-writer.js'
import { createEntry } from '../../domstack-manifest/records.js'

const pageInfo = /** @type {PageInfo} */ ({
  path: 'posts',
  outputName: 'index.html',
  outputRelname: 'posts/index.html',
  url: '/posts/',
  pageFile: { relname: 'posts/page.js' },
})

test('additional output paths use the actual page output directory and destination root', () => {
  const dest = resolve('public')
  const page = join(dest, 'posts', 'nested', 'index.html')
  /** @type {[string, string][]} */
  const cases = [
    ['data.json', 'posts/nested/data.json'],
    ['../feed.json', 'posts/feed.json'],
    ['../../feed.json', 'feed.json'],
    ['/feed.json', 'feed.json'],
    ['..\\feed.json', 'posts/feed.json'],
    ['./data.json', 'posts/nested/data.json'],
    ['..hidden/data.json', 'posts/nested/..hidden/data.json'],
  ]
  for (const [name, expected] of cases) {
    const result = resolveAdditionalOutputPath(dest, page, name)
    assert.equal(result.outputRelname, expected)
    assert.equal(result.filepath, join(dest, expected))
  }
})

test('additional output paths reject escapes, directory names and nonportable file names', () => {
  const dest = resolve('public')
  const page = join(dest, 'posts/index.html')
  for (const name of ['', ' ', '/', '.', '..', 'foo/', 'foo\\', 'foo/.', 'foo/..', '../../escape.json', '/../escape.json', '//server/file', '\\file', '\\\\server\\file', 'C:/file', 'C:file', 'file:stream', 'file\u0000.json', 'file?', 'NUL.json', 'aux', 'COM1.txt', 'dir./file', 'dir /file']) {
    assert.throws(() => resolveAdditionalOutputPath(dest, page, name), Error, name)
  }
})

test('writer stages sidecars with page ownership and non-navigation JSON records', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-additional-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  const outputs = await writeAdditionalOutputs({
    dest,
    pageFilePath: join(dest, 'posts/index.html'),
    pageInfo,
    additionalOutputs: [{ outputName: '/feed.json', content: '{"ok":true}' }, { outputName: 'nested/data.txt', content: 'hello' }],
  })
  assert.equal(await readFile(join(dest, 'feed.json'), 'utf8'), '{"ok":true}')
  assert.equal(await readFile(join(dest, 'posts/nested/data.txt'), 'utf8'), 'hello')
  assert.ok(outputs[0])
  assert.equal(outputs[0].kind, 'page-additional')
  assert.equal(outputs[0].sourceRelname, 'posts/page.js')
  assert.equal(outputs[0].pagePath, 'posts')
  assert.equal(outputs[0].pageUrl, '/posts/')
  assert.equal(outputs[0].url, '/feed.json')
  assert.equal(outputs[0].page, undefined)
  const entry = await createEntry({ dest, record: outputs[0] })
  assert.equal(entry?.role, 'subresource')
})

test('writer rejects symlink components and existing directories without touching their targets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'domstack-additional-links-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dest = join(root, 'stage')
  const outside = join(root, 'outside')
  await mkdir(dest)
  await mkdir(outside)
  await writeFile(join(outside, 'data.json'), 'unchanged')
  await symlink(outside, join(dest, 'linked'), 'dir')
  await symlink(join(outside, 'data.json'), join(dest, 'leaf.json'), 'file')
  await mkdir(join(dest, 'directory'))
  for (const outputName of ['linked/data.json', 'leaf.json', 'directory']) {
    await assert.rejects(writeAdditionalOutputs({
      dest,
      pageFilePath: join(dest, 'index.html'),
      pageInfo,
      additionalOutputs: [{ outputName, content: 'changed' }],
    }), /symlink|not a file/)
  }
  assert.equal(await readFile(join(outside, 'data.json'), 'utf8'), 'unchanged')
})

test('writer validates all sidecar paths before writing the batch', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-additional-invalid-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  await assert.rejects(writeAdditionalOutputs({
    dest,
    pageFilePath: join(dest, 'index.html'),
    pageInfo,
    additionalOutputs: [{ outputName: 'valid.json', content: '{}' }, { outputName: '../escape.json', content: '{}' }],
  }), /escapes dest/)
  await assert.rejects(readFile(join(dest, 'valid.json')), { code: 'ENOENT' })
})

test('writer preserves duplicate records for main to reject through output claims', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-additional-claims-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  const outputs = await writeAdditionalOutputs({
    dest,
    pageFilePath: join(dest, 'index.html'),
    pageInfo,
    additionalOutputs: [{ outputName: 'data.json', content: 'first' }, { outputName: './data.json', content: 'second' }],
  })
  assert.equal(outputs.length, 2)
  assert.ok(outputs[0])
  assert.ok(outputs[1])
  assert.equal(outputs[0].outputRelname, outputs[1].outputRelname)
  assert.equal(outputs[0].sourceRelname, outputs[1].sourceRelname)
})

test('page writer collects once after rendering and reports HTML and sidecars together', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-additional-page-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  /** @type {string[]} */
  const events = []
  const page = /** @type {PageData<any, any, any, any>} */ (/** @type {unknown} */ ({
    pageInfo,
    vars: {},
    async renderFullPage () { events.push('render'); return '<h1>Page</h1>' },
    async collectAdditionalOutputs () { events.push('collect'); return [{ outputName: 'data.json', content: '{}' }] },
  }))
  const result = await pageWriter({ dest, page })
  assert.deepEqual(events, ['render', 'collect'])
  assert.deepEqual(result.outputs.map(output => output.kind), ['page', 'page-additional'])
  assert.equal(await readFile(result.pageFilePath, 'utf8'), '<h1>Page</h1>')
  assert.equal(await readFile(join(dest, 'posts/data.json'), 'utf8'), '{}')
})
