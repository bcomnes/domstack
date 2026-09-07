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
 * @typedef {object} GlobalVars
 * @property {string} siteName
 *
 * @typedef {object} CollectionData
 * @property {BlogIndex[]} blogIndexes
 */

export const dataDependencies = ['blogIndexes']

/** @type {PagesFunction<IndexVars, string, GlobalVars, CollectionData>} */
export default function indexesPages ({ vars, data }) {
  const indexes = []

  for (const { year, posts } of data.blogIndexes) {
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
