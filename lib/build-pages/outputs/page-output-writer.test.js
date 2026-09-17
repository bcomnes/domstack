/**
 * @import { PageInfo } from '../../identify-pages.js'
 * @import { DomstackManifestRecord } from '../../domstack-manifest/index.js'
 * @import { PageOutputCache } from './page-output-writer.js'
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs, { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolvePageOutputPath, writePageOutputs } from './page-output-writer.js'

import { createEntry } from '../../domstack-manifest/records.js'

const pageInfo = /** @type {PageInfo} */ ({
  path: 'posts',
  outputName: 'index.html',
  outputRelname: 'posts/index.html',
  url: '/posts/',
  pageFile: { relname: 'posts/page.js' },
})

test('page output paths use the actual page output directory and destination root', () => {
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
    const result = resolvePageOutputPath(dest, page, name)
    assert.equal(result.outputRelname, expected)
    assert.equal(result.filepath, join(dest, expected))
  }
})

test('page output paths reject escapes, directory names and nonportable file names', () => {
  const dest = resolve('public')
  const page = join(dest, 'posts/index.html')
  for (const name of ['', ' ', '/', '.', '..', 'foo/', 'foo\\', 'foo/.', 'foo/..', '../../escape.json', '/../escape.json', '//server/file', '\\file', '\\\\server\\file', 'C:/file', 'C:file', 'file:stream', 'file\u0000.json', 'file?', 'NUL.json', 'aux', 'COM1.txt', 'dir./file', 'dir /file']) {
    assert.throws(() => resolvePageOutputPath(dest, page, name), Error, name)
  }
  for (const name of ['../../public', '../../escape.json']) {
    assert.throws(() => resolvePageOutputPath(dest, page, name), {
      message: `Page outputName escapes dest or names its directory: ${name}`,
    })
  }
})

test('writer writes sidecars with page ownership and non-navigation JSON records', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  const page = { pageInfo, outputRecords: /** @type {DomstackManifestRecord[]} */ ([]) }
  const outputs = await writePageOutputs({
    dest,
    pageFilePath: join(dest, 'posts/index.html'),
    page,
    pageOutputs: [{ outputName: '/feed.json', content: '{"ok":true}' }, { outputName: 'nested/data.txt', content: 'hello' }],
  })
  assert.equal(outputs, page.outputRecords)
  assert.equal(await readFile(join(dest, 'feed.json'), 'utf8'), '{"ok":true}')
  assert.equal(await readFile(join(dest, 'posts/nested/data.txt'), 'utf8'), 'hello')
  assert.ok(outputs[0])
  assert.equal(outputs[0].kind, 'page-output')
  assert.equal(outputs[0].sourceRelname, 'posts/page.js')
  assert.equal(outputs[0].pagePath, 'posts')
  assert.equal(outputs[0].pageUrl, '/posts/')
  assert.equal(outputs[0].url, '/feed.json')
  assert.equal(outputs[0].page, undefined)
  const entry = await createEntry({ dest, record: outputs[0] })
  assert.equal(entry?.role, 'subresource')
})

test('writer rejects symlink components and existing directories without touching their targets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'domstack-page-output-links-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dest = join(root, 'dest')
  const outside = join(root, 'outside')
  await mkdir(dest)
  await mkdir(outside)
  await writeFile(join(outside, 'data.json'), 'unchanged')
  await symlink(outside, join(dest, 'linked'), 'dir')
  await symlink(join(outside, 'data.json'), join(dest, 'leaf.json'), 'file')
  await mkdir(join(dest, 'directory'))
  for (const outputName of ['linked/data.json', 'leaf.json', 'directory']) {
    const page = { pageInfo, outputRecords: [] }
    /** @type {PageOutputCache} */
    const outputCache = new Map()
    await assert.rejects(writePageOutputs({
      dest,
      pageFilePath: join(dest, 'index.html'),
      page,
      pageOutputs: [{ outputName, content: 'changed' }],
      outputCache,
    }), /symlink|not a file/)
    assert.deepEqual(page.outputRecords, [])
    assert.equal(outputCache.size, 0)
  }
  assert.equal(await readFile(join(outside, 'data.json'), 'utf8'), 'unchanged')
})

test('writer validates each path before writing it, retaining earlier writes', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-invalid-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  const page = { pageInfo, outputRecords: /** @type {DomstackManifestRecord[]} */ ([]) }
  /** @type {PageOutputCache} */
  const outputCache = new Map()
  await assert.rejects(writePageOutputs({
    dest,
    pageFilePath: join(dest, 'index.html'),
    page,
    pageOutputs: [{ outputName: 'valid.json', content: '{}' }, { outputName: '../escape.json', content: '{}' }],
    outputCache,
  }), /escapes dest/)
  assert.equal(await readFile(join(dest, 'valid.json'), 'utf8'), '{}')
  assert.deepEqual(page.outputRecords.map(output => output.outputRelname), ['valid.json'])
  assert.deepEqual([...outputCache.keys()], [join(dest, 'valid.json')])
})

test('writer preserves duplicate records for duplicate-output warnings', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-claims-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  const outputs = await writePageOutputs({
    dest,
    pageFilePath: join(dest, 'index.html'),
    page: { pageInfo, outputRecords: [] },
    pageOutputs: [{ outputName: 'data.json', content: 'first' }, { outputName: './data.json', content: 'second' }],
  })
  assert.equal(outputs.length, 2)
  assert.ok(outputs[0])
  assert.ok(outputs[1])
  assert.equal(outputs[0].outputRelname, outputs[1].outputRelname)
  assert.equal(outputs[0].sourceRelname, outputs[1].sourceRelname)
})

test('writer caches SHA256 of UTF8 bytes and stat metadata, not output content', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-hash-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  const page = { pageInfo, outputRecords: [] }
  /** @type {PageOutputCache} */
  const outputCache = new Map()
  const content = 'café 🌊\n'
  const filepath = join(dest, 'data.txt')
  const outputs = await writePageOutputs({
    dest,
    pageFilePath: join(dest, 'index.html'),
    page,
    pageOutputs: [{ outputName: './data.txt', content }],
    outputCache,
  })
  const info = await lstat(filepath)
  assert.equal(info.size, Buffer.byteLength(content, 'utf8'))
  assert.deepEqual([...outputCache], [[filepath, {
    hash: createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex'),
    metadata: [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':'),
  }]])
  assert.equal(outputs, page.outputRecords)
  assert.equal(outputs.length, 1)
  assert.ok(outputs[0])
  assert.equal('content' in outputs[0], false)
  assert.equal(await readFile(filepath, 'utf8'), content)
})

for (const cached of [false, true]) {
  test(`writer overwrites existing equal bytes without reading with ${cached ? 'a cold' : 'no'} cache`, async t => {
    const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-cold-'))
    t.after(() => rm(dest, { recursive: true, force: true }))
    const filepath = join(dest, 'data.txt')
    await writeFile(filepath, 'equal bytes')
    const writes = t.mock.method(fs, 'writeFile')
    const reads = t.mock.method(fs, 'readFile', async () => { throw new Error('must not read destination content') })
    syncBuiltinESMExports()
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
    const page = { pageInfo, outputRecords: [] }
    /** @type {PageOutputCache | undefined} */
    const outputCache = cached ? new Map() : undefined
    const outputs = await writePageOutputs({
      dest,
      pageFilePath: join(dest, 'index.html'),
      page,
      pageOutputs: [{ outputName: 'data.txt', content: 'equal bytes' }],
      outputCache,
    })
    assert.equal(writes.mock.callCount(), 1)
    assert.deepEqual(writes.mock.calls[0]?.arguments, [filepath, 'equal bytes'])
    assert.equal(reads.mock.callCount(), 0)
    assert.equal(outputs, page.outputRecords)
    assert.equal(outputs.length, 1)
    assert.equal(outputCache?.has(filepath), cached ? true : undefined)
  })
}

test('writer skips matching cached bytes and metadata but still records every claim', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-warm-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  /** @type {PageOutputCache} */
  const outputCache = new Map()
  const page = { pageInfo, outputRecords: [] }
  const params = { dest, pageFilePath: join(dest, 'index.html'), page, outputCache }
  await writePageOutputs({ ...params, pageOutputs: [{ outputName: 'data.txt', content: 'same' }] })
  const previousCache = outputCache.get(join(dest, 'data.txt'))
  const writes = t.mock.method(fs, 'writeFile')
  const reads = t.mock.method(fs, 'readFile', async () => { throw new Error('must not read destination content') })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  const outputs = await writePageOutputs({
    ...params,
    pageOutputs: [{ outputName: './data.txt', content: 'same' }, { outputName: '/data.txt', content: 'same' }],
  })
  assert.equal(writes.mock.callCount(), 0)
  assert.equal(reads.mock.callCount(), 0)
  assert.equal(outputs, page.outputRecords)
  assert.equal(outputs.length, 3)
  assert.deepEqual(outputs[1], outputs[0])
  assert.deepEqual(outputs[2], outputs[0])
  assert.equal(outputCache.get(join(dest, 'data.txt')), previousCache)
})

test('writer rewrites on a hash mismatch or any stat metadata mismatch', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-mismatch-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  /** @type {PageOutputCache} */
  const outputCache = new Map()
  const filepath = join(dest, 'data.txt')
  const params = { dest, pageFilePath: join(dest, 'index.html'), page: { pageInfo, outputRecords: [] }, outputCache }
  const pageOutputs = [{ outputName: 'data.txt', content: 'same' }]
  await writePageOutputs({ ...params, pageOutputs })
  const writes = t.mock.method(fs, 'writeFile')
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  for (const field of ['hash', 'dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
    const cached = outputCache.get(filepath)
    assert.ok(cached)
    const metadata = cached.metadata.split(':')
    if (field === 'hash') cached.hash = 'stale'
    else metadata[['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].indexOf(field)] = 'stale'
    cached.metadata = metadata.join(':')
    writes.mock.resetCalls()
    await writePageOutputs({ ...params, pageOutputs })
    assert.equal(writes.mock.callCount(), 1, field)
    assert.notEqual(outputCache.get(filepath), cached, field)
  }
})

test('failed writes leave no successful records or cache entries, including stale cache entries', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-failure-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  const filepath = join(dest, 'data.txt')
  const cause = new Error('disk full')
  const writes = t.mock.method(fs, 'writeFile', async () => { throw cause })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  for (const stale of [false, true]) {
    const page = { pageInfo, outputRecords: [] }
    /** @type {PageOutputCache} */
    const outputCache = new Map(stale ? [[filepath, { hash: 'stale', metadata: 'stale' }]] : [])
    await assert.rejects(writePageOutputs({
      dest,
      pageFilePath: join(dest, 'index.html'),
      page,
      pageOutputs: [{ outputName: 'data.txt', content: 'not written' }],
      outputCache,
    }), error => error === cause)
    assert.deepEqual(page.outputRecords, [])
    assert.equal(outputCache.size, 0)
  }
  assert.equal(writes.mock.callCount(), 2)
})

test('writer streams each output to disk and retains successful records and cache after iterator failure', async t => {
  const dest = await mkdtemp(join(tmpdir(), 'domstack-page-output-iterator-'))
  t.after(() => rm(dest, { recursive: true, force: true }))
  /** @type {PageOutputCache} */
  const outputCache = new Map()
  const page = { pageInfo, outputRecords: /** @type {DomstackManifestRecord[]} */ ([]) }
  const filepath = join(dest, 'first.txt')
  const cause = new Error('iterator failed')
  let closed = false
  async function * pageOutputs () {
    try {
      yield { outputName: 'first.txt', content: 'first' }
      assert.equal(await readFile(filepath, 'utf8'), 'first')
      assert.deepEqual(page.outputRecords.map(output => output.outputRelname), ['first.txt'])
      assert.equal(outputCache.has(filepath), true)
      throw cause
    } finally {
      closed = true
    }
  }
  await assert.rejects(writePageOutputs({
    dest,
    pageFilePath: join(dest, 'index.html'),
    page,
    pageOutputs: pageOutputs(),
    outputCache,
  }), error => error === cause)
  assert.equal(closed, true)
  assert.deepEqual(page.outputRecords.map(output => output.outputRelname), ['first.txt'])
  assert.deepEqual([...outputCache.keys()], [filepath])
})
