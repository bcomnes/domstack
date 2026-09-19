import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { importAuthor } from './import.ts'
import { AuthorRegistry, resolveBlogAuthors, validateAuthorMeta, validateAuthorUrl, validateAuthorUsername } from '../../site/lib/authors.ts'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
function fakeFetch (options = {}) {
  return async (input, init) => {
    const url = String(input)
    assert.equal(init?.redirect, 'error')
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('Authorization'), new URL(url).hostname === 'api.github.com' ? 'Bearer test-token' : null)
    if (url.includes(options.fail || 'never-match')) return new Response('upstream failure', { status: 500 })
    if (url.endsWith('/social_accounts')) return options.organization ? new Response('', { status: 404 }) : Response.json([{ provider: 'mastodon', url: 'https://example.org/@alice' }])
    if (url.endsWith('/users/alice')) return Response.json({ login: 'Alice', name: 'Alice Example', blog: 'example.org', type: options.organization ? 'Organization' : 'User', avatar_url: 'https://avatars.githubusercontent.com/u/1' })
    if (url.includes('avatars.githubusercontent.com')) return new Response(png, { headers: { 'content-type': 'image/png' } })
    return new Response('')
  }
}

test('imports, loads, and preserves previous data on failed refresh', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'domstack-authors-'))
  try {
    const options = { directory, fetcher: fakeFetch(), token: 'test-token' }
    const meta = await importAuthor('Alice', options)
    assert.equal(meta.website, 'https://example.org/')
    assert.equal(meta.keys, '')
    assert.equal(meta.gpg, '')
    assert.deepEqual(await new AuthorRegistry(directory).get('alice'), { username: 'alice', name: 'Alice Example', url: 'https://example.org/', avatar: '/authors/alice/avatar.png' })

    const before = await readFile(join(directory, 'alice', 'author-meta.json'), 'utf8')
    for (const fail of ['/users/alice', 'avatars.githubusercontent.com', '.keys', '.gpg']) {
      await assert.rejects(importAuthor('alice', { ...options, fetcher: fakeFetch({ fail }) }), /HTTP 500/)
      assert.equal(await readFile(join(directory, 'alice', 'author-meta.json'), 'utf8'), before)
      assert.deepEqual(await readdir(directory), ['alice'])
    }
    await importAuthor('alice', { ...options, fetcher: fakeFetch({ organization: true }) })
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'alice', 'author-meta.json'), 'utf8')).links, [])
    assert.deepEqual(await readdir(directory), ['alice'])
    assert.throws(() => validateAuthorMeta({ ...meta, avatar: '../avatar.png' }, 'alice'), /avatar/)
    assert.throws(() => validateAuthorMeta({ ...meta, keys: 'PRIVATE KEY' }, 'alice'), /public key/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('registry shares in-flight reads, caches successes, and clears explicitly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'domstack-author-cache-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const meta = await importAuthor('alice', { directory, fetcher: fakeFetch(), token: 'test-token' })
  const registry = new AuthorRegistry(directory)
  const first = registry.get('alice')
  assert.strictEqual(registry.get('alice'), first)
  const author = await first
  assert.ok(Object.isFrozen(author))
  assert.throws(() => { author.name = 'Mutated' }, TypeError)
  const a = await registry.resolve(['alice'], 'first.md')
  const b = await registry.resolve(['alice'], 'second.md')
  assert.notStrictEqual(a, b)
  assert.strictEqual(a[0], b[0])
  const filename = join(directory, 'alice', 'author-meta.json')
  await writeFile(filename, JSON.stringify({ ...meta, name: 'Updated Alice' }))
  assert.strictEqual(registry.get('alice'), first)
  assert.equal((await registry.get('alice')).name, 'Alice Example')
  registry.clear('alice')
  assert.equal((await registry.get('alice')).name, 'Updated Alice')
  const beforeClear = registry.get('alice')
  registry.clear()
  assert.notStrictEqual(registry.get('alice'), beforeClear)
  await registry.get('alice')
})

test('failed reads are retried and clearing an in-flight read does not evict its replacement', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'domstack-author-retry-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const meta = await importAuthor('alice', { directory, fetcher: fakeFetch(), token: 'test-token' })
  const registry = new AuthorRegistry(directory)
  const filename = join(directory, 'alice', 'author-meta.json')
  await writeFile(filename, 'invalid JSON')
  const failed = registry.get('alice')
  assert.strictEqual(registry.get('alice'), failed)
  await assert.rejects(failed, /author-meta\.json/)
  await writeFile(filename, JSON.stringify(meta))
  assert.equal((await registry.get('alice')).name, 'Alice Example')
  registry.clear()
  const old = registry.get('alice')
  registry.clear('alice')
  const replacement = registry.get('alice')
  assert.notStrictEqual(old, replacement)
  await Promise.all([old, replacement])
  assert.strictEqual(registry.get('alice'), replacement)
})

test('checked-in registry resolves the canonical DOMStack author', async () => {
  const authors = await resolveBlogAuthors(['bcomnes'], 'post.md')
  assert.deepEqual(authors.map(author => author.username), ['bcomnes'])
  assert.equal(authors[0].url, 'https://bret.io/')
})

test('rejects unsafe usernames, URLs, missing authors, duplicates, and legacy aliases in arrays', async () => {
  for (const value of ['../alice', '.', 'a/b', 'Alice', '-alice', 'alice-', 'a--b', '', 'x'.repeat(40)]) assert.throws(() => validateAuthorUsername(value))
  for (const value of ['javascript:alert(1)', 'https://user:password@example.org', '//example.org', 'https://example.org/\n']) assert.throws(() => validateAuthorUrl(value))
  for (const value of [undefined, 'bcomnes', [], ['bcomnes', 'bcomnes'], ['../bcomnes'], ['jwerle'], ['oro-computer'], ['joe'], ['bret'], ['oro'], [null], ['unregistered-example']]) await assert.rejects(resolveBlogAuthors(value, 'post.md'), /post\.md:/)
})
