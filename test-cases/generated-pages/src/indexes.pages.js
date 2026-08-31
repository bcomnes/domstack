/**
 * @import { PagesFunction } from '#types'
 */

/**
 * @typedef {object} BlogPost
 * @property {string} path
 * @property {string} url
 * @property {string} title
 * @property {string} publishDate
 */

/**
 * @typedef {object} BlogIndex
 * @property {string} year
 * @property {BlogPost[]} posts
 */

/**
 * @typedef {object} IndexVars
 * @property {string} layout
 * @property {string} title
 * @property {BlogPost[]} posts
 */

/**
 * @typedef {object} CollectionVars
 * @property {string} siteName
 * @property {BlogIndex[]} blogIndexes
 */

/** @type {PagesFunction<IndexVars, string, CollectionVars>} */
export default function indexesPages ({ vars }) {
  const indexes = []

  for (const { year, posts } of vars.blogIndexes) {
    indexes.push({
      outputName: `blog/${year}/index.html`,
      vars: {
        layout: 'blog-index',
        title: `${vars.siteName}: ${year} posts`,
        posts,
      },
    })
  }

  return indexes
}
