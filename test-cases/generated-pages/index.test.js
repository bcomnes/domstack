import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testBuild } from '../../index.js'
import { join } from 'node:path'
import * as cheerio from 'cheerio'
const __dirname = import.meta.dirname

test('builds generated pages and templates from declared global data', async (t) => {
  const src = join(__dirname, './src')
  const build = await testBuild(src)
  const { results, readOutput } = build

  t.after(async () => {
    await build.cleanup()
  })

  assert.equal(results.siteData.pagesFiles.length, 4, 'four pages files are discovered')
  assert.equal(results.siteData.pages.length, 7, 'siteData.pages contains the seven source-backed pages')
  assert.equal(results.siteData.pages.some(page => Boolean(page.generated)), false, 'siteData.pages remains discovery-only')

  const redirectCases = [
    { from: 'old-url', to: '/new-url/', destination: 'new-url/index.html', heading: 'New URL' },
    { from: 'legacy-url', to: '/new-url/', destination: 'new-url/index.html', heading: 'New URL' },
    { from: 'docs/old-guide', to: '/guides/current/', destination: 'guides/current/index.html', heading: 'Current Guide' },
    { from: 'company', to: '/about/', destination: 'about/index.html', heading: 'About' },
  ]

  for (const { from, to, destination, heading } of redirectCases) {
    const redirectHtml = await readOutput(`${from}/index.html`)
    assert.match(redirectHtml, new RegExp(`<meta http-equiv="refresh" content="0;url=${to}">`), `${from} renders through the redirect layout`)
    assert.match(redirectHtml, new RegExp(`<a href="${to}">${to}</a>`), `${from} links to its canonical destination`)
    const destinationHtml = await readOutput(destination)
    assert.match(destinationHtml, new RegExp(`<h1[^>]*>${heading}</h1>`), `${to} is backed by a concrete page`)
    assert.match(destinationHtml, /<meta name="source-page-count" content="7">/, `${to} receives its layout's subscribed global data`)
  }

  const blog2024IndexDoc = cheerio.load(await readOutput('blog/2024/index.html'))
  const blog2024Links = blog2024IndexDoc('.blog-entry-link').toArray().map(link => ({
    href: blog2024IndexDoc(link).attr('href'),
    title: blog2024IndexDoc(link).text().trim(),
  }))
  const blog2024Dates = blog2024IndexDoc('.blog-entry-date').toArray().map(time => blog2024IndexDoc(time).text().trim())
  assert.deepEqual(blog2024Links, [
    { href: '/blog/2024/post-two/', title: 'Post Two' },
    { href: '/blog/2024/post-one/', title: 'Post One' },
  ], 'generated yearly indexes link concrete posts newest-first')
  assert.deepEqual(blog2024Dates, ['2024-06-15', '2024-01-02'], 'generated yearly indexes render publication dates')

  const blog2023IndexDoc = cheerio.load(await readOutput('blog/2023/index.html'))
  assert.deepEqual(blog2023IndexDoc('.blog-entry-link').toArray().map(link => ({
    href: blog2023IndexDoc(link).attr('href'),
    title: blog2023IndexDoc(link).text().trim(),
  })), [
    { href: '/blog/2023/older-post/', title: 'Older Post' },
  ], 'a generated index is created for each year with posts')

  const introspectionHtml = await readOutput('generated-introspection/index.html')
  const introspectionDoc = cheerio.load(introspectionHtml)
  assert.equal(introspectionDoc('#has-pages').text(), 'false', 'pages files do not receive the raw page collection')
  assert.equal(introspectionDoc('#has-site-data').text(), 'false', 'pages files do not receive the discovery registry')
  assert.equal(introspectionDoc('meta[name="source-page-count"]').attr('content'), '7', 'global.data sees source-backed pages before pages files run')

  const stylesheetHrefs = Array.from(introspectionDoc('link[rel="stylesheet"]')).map(link => introspectionDoc(link).attr('href') ?? '')
  assert.ok(stylesheetHrefs.some(href => href.startsWith('/global-') && href.endsWith('.css')), 'generated page includes global stylesheet')
  assert.ok(stylesheetHrefs.some(href => href.startsWith('/root.layout-') && href.endsWith('.css')), 'generated page includes layout stylesheet')
  assert.ok(!stylesheetHrefs.some(href => href.startsWith('./style-')), 'generated page does not include page-local stylesheet')

  const scriptSrcs = Array.from(introspectionDoc('script[type="module"]')).map(script => introspectionDoc(script).attr('src') ?? '')
  assert.ok(scriptSrcs.some(src => src.startsWith('/global.client-') && src.endsWith('.js')), 'generated page includes global client')
  assert.ok(scriptSrcs.some(src => src.startsWith('/root.layout.client-') && src.endsWith('.js')), 'generated page includes layout client')
  assert.ok(!scriptSrcs.some(src => src.startsWith('./client-')), 'generated page does not include page-local client')

  const asyncHtml = await readOutput('async-generated/index.html')
  assert.match(asyncHtml, /async generated page/, 'async iterable pages files are supported')

  const summary = JSON.parse(await readOutput('summary.json'))
  assert.equal(summary.sourcePageCount, 7, 'template data includes the subscribed source page count')
  assert.equal(summary.blogPostCount, 3, 'template data includes the subscribed blog collection')
})
