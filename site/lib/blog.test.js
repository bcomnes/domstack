/** @import { BlogPost } from './blog.ts' */
import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from 'cheerio'
import { atomFeed, feedHtml, jsonFeed } from './blog-feeds.ts'
import { blogDate, projectBlog, validateBlogVars } from './blog.ts'
import { resolveBlogAuthor } from './authors.ts'

const site = 'https://domstack.neocities.org'
/** @type {BlogPost} */
const post = {
  url: '/blog/2026/example/',
  title: 'Example & Post',
  description: 'A summary.',
  publishDate: '2026-01-02T00:00:00.000Z',
  authorId: 'bret',
  authorName: 'Bret Comnes',
  authorUrl: 'https://bret.io',
  html: '<p><a href="../other/">Other</a><img src="image.png"></p>',
}

test('blog metadata validates RFC 3339 dates and resolves both Bret author IDs', () => {
  assert.equal(blogDate('2024-02-29T12:00:00Z', 'publishDate', 'sample'), '2024-02-29T12:00:00.000Z')
  assert.deepEqual(resolveBlogAuthor('bret', 'sample'), { id: 'bret', name: 'Bret Comnes', url: 'https://bret.io' })
  assert.deepEqual(resolveBlogAuthor('bcomnes', 'sample'), { id: 'bcomnes', name: 'Bret Comnes', url: 'https://bret.io' })
  assert.throws(() => validateBlogVars({ description: 'Summary', publishDate: '2026-01-02' }, 'sample'), /sample: title/)
  assert.throws(() => validateBlogVars({ title: 'Title', description: 'Summary', publishDate: '2026-01-02' }, 'sample'), /sample: publishDate/)
  assert.throws(() => validateBlogVars({ title: 'Title', description: 'Summary', publishDate: '2026-01-02T00:00:00Z', updatedDate: '2025-01-02T00:00:00Z' }, 'sample'), /updatedDate/)
})

test('blog projection sorts posts, groups archives, and excludes drafts from feeds', () => {
  const data = projectBlog([post, { ...post, url: '/blog/2025/old/', publishDate: '2025-01-01T00:00:00Z' }, { ...post, url: '/blog/2026/draft/', draft: true, publishDate: '2099-01-01T00:00:00Z' }])
  assert.deepEqual(data.blogPosts.map(entry => entry.url), ['/blog/2026/draft/', '/blog/2026/example/', '/blog/2025/old/'])
  assert.deepEqual(data.blogArchives.map(archive => archive.year), ['2026', '2025'])
  assert.deepEqual(data.blogFeed.map(entry => entry.url), ['/blog/2026/example/', '/blog/2025/old/'])
})

test('feeds include author metadata and absolute article assets', () => {
  const $ = load(feedHtml(post, site))
  assert.equal($('a').attr('href'), `${site}/blog/2026/other/`)
  assert.equal($('img').attr('src'), `${site}/blog/2026/example/image.png`)
  const json = JSON.parse(jsonFeed([post], site))
  assert.equal(json.items[0].authors[0].name, 'Bret Comnes')
  assert.equal(json.items[0].content_html, feedHtml(post, site))
  assert.match(atomFeed([post], site), /<author><name>Bret Comnes<\/name><uri>https:\/\/bret\.io<\/uri><\/author>/)
})
