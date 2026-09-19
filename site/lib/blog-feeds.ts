// @ts-expect-error jsonfeed-to-atom has no published TypeScript declarations.
import jsonfeedToAtom from 'jsonfeed-to-atom'
import { load } from 'cheerio'
import { projectBlog, type BlogPost } from './blog.ts'

interface FeedAuthor {
  name: string
  url: string
  avatar: string
}

interface JsonFeedItem {
  id: string
  url: string
  title: string
  summary: string
  content_html: string
  date_published: string
  date_modified: string
  authors: FeedAuthor[]
}

interface JsonFeed {
  version: string
  title: string
  home_page_url: string
  feed_url: string
  items: JsonFeedItem[]
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
  const json = JSON.parse(jsonFeed(posts, siteUrl)) as JsonFeed
  const atomInput = {
    ...json,
    version: 'https://jsonfeed.org/version/1',
    author: json.items[0]?.authors[0],
    items: json.items.map(({ authors, ...item }) => ({ ...item, author: authors[0] })),
  }
  return jsonfeedToAtom(atomInput)
}
