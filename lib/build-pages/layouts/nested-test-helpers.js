/**
 * @import { TestContext } from 'node:test'
 * @import { Logger } from 'pino'
 */
import { cp, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pino from 'pino'
import { DomStack } from '../../../index.js'

export const rootLayout = readFileSync(new URL('../../../test-cases/nested-layouts/src/root.layout.js', import.meta.url), 'utf8')
export const articleLayout = readFileSync(new URL('../../../test-cases/nested-layouts/src/article.layout.js', import.meta.url), 'utf8')

/** @param {TestContext} t @param {Logger} [logger] */
export async function setup (t, logger = pino({ level: 'silent' })) {
  const dir = await mkdtemp(join(import.meta.dirname, '.tmp-'))
  const src = join(dir, 'src')
  const dest = join(dir, 'public')
  await mkdir(src)
  await cp(new URL('../../../test-cases/nested-layouts/src/', import.meta.url), src, { recursive: true })
  const domstack = new DomStack(src, dest, { logger })
  t.after(async () => {
    if (domstack.watching) await domstack.stopWatching()
    await rm(dir, { recursive: true, force: true })
  })
  return {
    src,
    dest,
    domstack,
    read: (/** @type {string} */ name) => readFile(join(dest, name), 'utf8'),
    write: (/** @type {string} */ name, /** @type {string} */ text) => writeFile(join(src, name), text),
  }
}

export const globalData = `
import assert from 'node:assert/strict'
export default async ({ pages }) => {
  const source = pages.find(page => page.pageInfo.path === 'source')
  await assert.rejects(source.renderFullPage(), /Global data is not available/)
  return {
  navigation: 'nav-v1',
  recentPosts: 'recent-v1',
  footer: 'footer-v1',
  pageMessage: 'message-v1',
  rendered: await source.renderInnerPage()
  }
}
`

/** @param {TestContext} t */
export async function setupSubscriptions (t) {
  const site = await setup(t)
  await site.write('global.data.js', globalData)
  await site.write('root.layout.js', `
    import assert from 'node:assert/strict'
    export const vars = { dataDeps: ['navigation', 'rendered'] }
    export default ({ children, data, vars }) => {
      assert.deepEqual(Object.keys(data), ['navigation', 'rendered'])
      assert.throws(() => data.recentPosts, /undeclared global data key/)
      assert.equal(vars.dataDeps, undefined)
      return '<main>' + data.navigation + data.rendered + children + '</main>'
    }
  `)
  await site.write('article.layout.js', `
    import assert from 'node:assert/strict'
    export const parentLayout = 'root'
    export const vars = { dataDeps: ['recentPosts'] }
    export default ({ children, data }) => {
      assert.deepEqual(Object.keys(data), ['recentPosts'])
      assert.throws(() => data.navigation, /undeclared global data key/)
      return '<article>' + data.recentPosts + children + '</article>'
    }
  `)
  await site.write('post.layout.js', `
    import assert from 'node:assert/strict'
    export const parentLayout = 'article'
    export const vars = { dataDeps: ['footer'] }
    export default ({ children, data }) => {
      assert.deepEqual(Object.keys(data), ['footer'])
      assert.throws(() => data.pageMessage, /undeclared global data key/)
      return '<section>' + data.footer + children + '</section>'
    }
  `)
  await site.write('typed/page.ts', `
    import assert from 'node:assert/strict'
    export const vars = { layout: 'post', dataDeps: ['pageMessage'] }
    export default ({ data }) => {
      assert.deepEqual(Object.keys(data), ['pageMessage'])
      assert.throws(() => data.footer, /undeclared global data key/)
      return '<p>' + data.pageMessage + '</p>'
    }
  `)
  return site
}
