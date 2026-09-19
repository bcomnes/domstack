import { load } from 'cheerio'
import { projectBlog, type BlogPost } from './blog.ts'

function xmlEscape (value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function absoluteSrcset (value: string, base: URL): string {
  const candidates: string[] = []
  let rest = value
  while (rest.length) {
    rest = rest.replace(/^[\t\n\f\r ,]+/, '')
    const token = /^[\t\n\f\r ]+/.test(rest) ? undefined : /^[^\t\n\f\r ]+/.exec(rest)?.[0]
    if (!token) break
    rest = rest.slice(token.length)
    let descriptors = ''
    if (!token.endsWith(',')) {
      let depth = 0
      let end = 0
      for (; end < rest.length; end++) {
        if (rest[end] === '(') depth++
        if (rest[end] === ')') depth--
        if (rest[end] === ',' && depth === 0) break
      }
      descriptors = rest.slice(0, end).trim()
      rest = rest.slice(end + 1)
    }
    candidates.push(new URL(token.replace(/,+$/, ''), base).href + (descriptors ? ` ${descriptors}` : ''))
  }
  return candidates.join(', ')
}

export function feedHtml (post: BlogPost, siteUrl: string): string {
  const base = new URL(post.url, siteUrl)
  const $ = load(post.html, {}, false)
  $('[href], [src], [poster]').each((_index, element) => {
    for (const attribute of ['href', 'src', 'poster']) {
      const value = $(element).attr(attribute)
      if (value !== undefined) $(element).attr(attribute, new URL(value, base).href)
    }
  })
  $('[srcset]').each((_index, element) => {
    $(element).attr('srcset', absoluteSrcset($(element).attr('srcset')!, base))
  })
  return $.html()
}

export function jsonFeed (posts: readonly BlogPost[], siteUrl: string): string {
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'DOMStack Blog',
    home_page_url: new URL('/blog/', siteUrl).href,
    feed_url: new URL('/feed.json', siteUrl).href,
    items: projectBlog(posts).blogFeed.map(post => ({
      id: new URL(post.url, siteUrl).href,
      url: new URL(post.url, siteUrl).href,
      title: post.title,
      summary: post.description,
      content_html: feedHtml(post, siteUrl),
      date_published: post.publishDate,
      date_modified: post.updatedDate ?? post.publishDate,
      authors: post.authors.map(author => ({ name: author.name, url: author.url, avatar: new URL(author.avatar, siteUrl).href })),
    })),
  }, null, 2) + '\n'
}

export function atomFeed (posts: readonly BlogPost[], siteUrl: string): string {
  const entries = projectBlog(posts).blogFeed
  const updated = entries.reduce((latest, post) => {
    const date = post.updatedDate ?? post.publishDate
    return Date.parse(date) > Date.parse(latest) ? date : latest
  }, entries.length ? entries[0]!.updatedDate ?? entries[0]!.publishDate : '1970-01-01T00:00:00.000Z')
  const url = (path: string) => xmlEscape(new URL(path, siteUrl).href)
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>DOMStack Blog</title>
<id>${url('/blog/')}</id>
<link rel="alternate" href="${url('/blog/')}"/>
<link rel="self" type="application/atom+xml" href="${url('/feed.xml')}"/>
<updated>${xmlEscape(updated)}</updated>
${entries.map(post => `<entry>
<id>${url(post.url)}</id>
<title>${xmlEscape(post.title)}</title>
<link rel="alternate" href="${url(post.url)}"/>
<published>${xmlEscape(post.publishDate)}</published>
<updated>${xmlEscape(post.updatedDate ?? post.publishDate)}</updated>
${post.authors.map(author => `<author><name>${xmlEscape(author.name)}</name><uri>${xmlEscape(author.url)}</uri></author>`).join('\n')}
<summary>${xmlEscape(post.description)}</summary>
<content type="html">${xmlEscape(feedHtml(post, siteUrl))}</content>
</entry>`).join('\n')}
</feed>\n`
}
