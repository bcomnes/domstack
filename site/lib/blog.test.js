/** @import { BlogPage, BlogPost } from './blog.ts' */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from 'cheerio'
import { atomFeed, feedHtml, jsonFeed } from './blog-feeds.ts'
import { blogIndex } from './blog-index.ts'
import { blogDate, projectBlog, readBlogPost, validateBlogVars } from './blog.ts'
import { resolveBlogAuthors } from './authors.ts'

const site = 'https://domstack.neocities.org'
const sampleAuthors = await resolveBlogAuthors(['bcomnes'], 'sample')
/** @type {BlogPost} */
const post = {
  url: '/blog/2026/example/',
  title: 'Example & Post',
  description: 'A summary.',
  publishDate: '2026-01-02T00:00:00.000Z',
  authors: [...sampleAuthors],
  html: '<p><a href="../other/">Other</a><img src="image.png"></p>',
}

test('blog metadata validates RFC 3339 dates and author arrays', async () => {
  assert.equal(blogDate('2024-02-29T12:00:00Z', 'publishDate', 'sample'), '2024-02-29T12:00:00.000Z')
  assert.deepEqual(await resolveBlogAuthors(['bcomnes'], 'sample'), [{ username: 'bcomnes', name: 'Bret Comnes', url: 'https://bret.io/', avatar: '/authors/bcomnes/avatar.jpg' }])
  await assert.rejects(validateBlogVars({ description: 'Summary', publishDate: '2026-01-02T00:00:00Z', authors: ['bcomnes'] }, 'sample'), /sample: title/)
  await assert.rejects(validateBlogVars({ title: 'Title', description: 'Summary', publishDate: '2026-01-02T00:00:00Z', authors: [] }, 'sample'), /nonempty array/)
  await assert.rejects(validateBlogVars({ title: 'Title', description: 'Summary', publishDate: '2026-01-02T00:00:00Z', authors: ['bcomnes', 'bcomnes'] }, 'sample'), /duplicate/)
  await assert.rejects(validateBlogVars({ title: 'Title', description: 'Summary', publishDate: '2026-01-02T00:00:00Z', authors: ['bret'] }, 'sample'), /unknown author|unknown|author-meta/)
  await assert.rejects(validateBlogVars({ title: 'Title', description: 'Summary', publishDate: '2026-01-02T00:00:00Z', authors: ['bcomnes'], updatedDate: '2025-01-02T00:00:00Z' }, 'sample'), /updatedDate/)
})

test('blog posts require an explicit frontmatter title instead of an inferred H1', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'domstack-blog-'))
  const filepath = join(directory, 'page.md')
  /** @param {string} source @param {string} title @returns {BlogPage} */
  const page = (source, title = 'Inferred H1') => ({
    sourceId: source,
    vars: { layout: 'blog', title, description: 'Summary', publishDate: '2026-01-02T00:00:00Z', authors: ['bcomnes'] },
    pageInfo: { type: 'md', url: '/blog/2026/example/', pageFile: { filepath } },
    renderInnerPage: async () => '<p>Content.</p>',
  })
  try {
    await writeFile(filepath, '---\nlayout: blog\ndescription: Summary\npublishDate: "2026-01-02T00:00:00Z"\nauthors: [bcomnes]\n---\n\n# Inferred H1\n')
    await assert.rejects(readBlogPost(page('blog/2026/example/page.md')), /title is required in blog post frontmatter/)
    await writeFile(filepath, '---\nlayout: blog\ntitle: Explicit title\ndescription: Summary\npublishDate: "2026-01-02T00:00:00Z"\nauthors: [bcomnes]\n---\n\nContent.\n')
    const result = await readBlogPost(page('blog/2026/example/page.md', 'Explicit title'))
    assert.equal(result.title, 'Explicit title')
    assert.deepEqual(result.authors, sampleAuthors)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('blog projection sorts posts, groups archives, and excludes drafts from feeds', () => {
  const data = projectBlog([post, { ...post, url: '/blog/2025/old/', publishDate: '2025-01-01T00:00:00Z' }, { ...post, url: '/blog/2026/draft/', draft: true, publishDate: '2099-01-01T00:00:00Z' }])
  assert.deepEqual(data.blogPosts.map(entry => entry.url), ['/blog/2026/draft/', '/blog/2026/example/', '/blog/2025/old/'])
  assert.deepEqual(data.blogArchives.map(archive => archive.year), ['2026', '2025'])
  assert.deepEqual(data.blogFeed.map(entry => entry.url), ['/blog/2026/example/', '/blog/2025/old/'])
})

test('blog index feed links expose icons, feed types, and alternate relations', () => {
  const $ = load(blogIndex([post], []))
  assert.deepEqual($('.blog-feeds a').toArray().map(element => ({ href: $(element).attr('href'), rel: $(element).attr('rel'), type: $(element).attr('type'), icon: $(element).find('img').attr('src') })), [
    { href: '/feed.json', rel: 'alternate', type: 'application/feed+json', icon: '/blog/jsonfeed.svg' },
    { href: '/feed.xml', rel: 'alternate', type: 'application/atom+xml', icon: '/blog/atom.svg' },
  ])
})

test('feeds include ordered author metadata, avatars, and absolute article assets', () => {
  const $ = load(feedHtml(post, site))
  assert.equal($('a').attr('href'), `${site}/blog/2026/other/`)
  assert.equal($('img').attr('src'), `${site}/blog/2026/example/image.png`)
  const json = JSON.parse(jsonFeed([post], site))
  assert.deepEqual(json.items[0].authors, [{ name: 'Bret Comnes', url: 'https://bret.io/', avatar: `${site}/authors/bcomnes/avatar.jpg` }])
  assert.equal(json.items[0].content_html, feedHtml(post, site))
  assert.match(atomFeed([post], site), /<author><name>Bret Comnes<\/name><uri>https:\/\/bret\.io\/<\/uri><\/author>/)
})
