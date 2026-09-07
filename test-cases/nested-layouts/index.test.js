/** @import { TestContext } from 'node:test' */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import pino from 'pino'
import { DomStack } from '../../index.js'

const rootLayout = `
import { label } from './label.js'
export const vars = { inherited: 'root', overridden: 'root', title: 'root' }
export default async function ({ children, vars, styles, scripts }) {
  return '<html><head>' + styles.map(s => '<link href="' + s + '">').join('') +
    scripts.map(s => '<script src="' + s + '"></script>').join('') +
    '</head><body data-root="' + label + '" data-vars="' +
    [vars.inherited, vars.overridden, vars.title].join(':') + '">' + children + '</body></html>'
}`
const articleLayout = `
export const parentLayout = 'root'
export const vars = async () => ({ overridden: 'article', title: 'article' })
export default async ({ children }) => '<article>' + children.html + '</article>'
`
const postLayout = `
export const parentLayout = 'article'
export default ({ children }) => ({ html: '<section>' + children + '</section>' })
`

/** @param {TestContext} t */
async function setup (t) {
  const dir = await mkdtemp(join(import.meta.dirname, '.tmp-'))
  const src = join(dir, 'src')
  const dest = join(dir, 'public')
  await mkdir(src)
  /** @type {Record<string, string>} */
  const files = {
    'root.layout.js': rootLayout,
    'article.layout.js': articleLayout,
    'post.layout.js': postLayout,
    'other.layout.js': "export default ({children}) => '<aside>' + children + '</aside>'",
    'label.js': "export const label = 'v1'",
    'other-label.js': "export const label = 'alternate'",
    'global.vars.js': "export default { inherited: 'global', overridden: 'global', layout: 'other' }",
    'source/page.md': '---\nlayout: post\ntitle: source\n---\nContent',
    'plain/page.html': '<p>Plain</p>',
    'typed/page.ts': "export const vars = {layout: 'post', title: 'typed'}; export default () => '<p>Typed</p>'",
    'markup/page.html': '<p>Markup</p>',
    'markup/page.vars.js': "export default {layout: 'post', title: 'markup'}",
    'archive.pages.js': "export default [{ outputName: 'archive.html', vars: {layout: 'post', title: 'archive'}, children: '<p>Archive</p>' }]",
    'global.css': 'body { color: black }',
    'global.client.js': 'console.log("global")',
    'source/style.css': 'p { color: blue }',
    'source/client.js': 'console.log("page")',
    'root.layout.css': 'body { background: white }',
    'article.layout.css': 'article { display: block }',
    'post.layout.css': 'section { display: block }',
    'root.layout.client.js': 'console.log("root")',
    'article.layout.client.js': 'console.log("article")',
    'post.layout.client.js': 'console.log("post")',
  }
  await Promise.all(Object.entries(files).map(async ([name, contents]) => {
    await mkdir(dirname(join(src, name)), { recursive: true })
    await writeFile(join(src, name), contents)
  }))
  const domstack = new DomStack(src, dest, { logger: pino({ level: 'silent' }) })
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

test('nested layouts render source and generated pages, cascade vars and preserve intermediate values', async t => {
  const { domstack, read, write } = await setup(t)
  await write('source/page.vars.js', "export default {layout: 'other', title: 'adjacent'}")
  const results = await domstack.build()
  assert.equal(results.pageBuildResults?.errors.length, 0)
  for (const [output, title] of [['source/index.html', 'source'], ['typed/index.html', 'typed'], ['markup/index.html', 'markup'], ['archive.html', 'archive']]) {
    const html = await read(/** @type {string} */ (output))
    assert.match(html, new RegExp(`data-vars="root:article:${title}"`))
    assert.match(html, /<article>\s*<section>/)
    assert.equal((html.match(/<html>/g) ?? []).length, 1, 'the root layout runs once')
    assert.equal((html.match(/<article>/g) ?? []).length, 1, 'the middle layout runs once')
    assert.equal((html.match(/<section>/g) ?? []).length, 1, 'the inner layout runs once')
    const styles = [...html.matchAll(/<link href="([^"]+)"/g)].map(match => match[1]?.replace(/-[A-Z0-9]+\./, '.'))
    assert.deepEqual(styles, ['/global.css', '/root.layout.css', '/article.layout.css', '/post.layout.css', ...(title === 'source' ? ['./style.css'] : [])])
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]?.replace(/-[A-Z0-9]+\./, '.'))
    assert.deepEqual(scripts, ['/global.client.js', '/root.layout.client.js', '/article.layout.client.js', '/post.layout.client.js', ...(title === 'source' ? ['./client.js'] : [])])
  }
  assert.match(await read('plain/index.html'), /<aside>/)
})

test('watch follows ancestor edits, imports, reparenting, and asset membership', { timeout: 60_000 }, async t => {
  const { domstack, read, write, dest, src } = await setup(t)
  await domstack.watch({ serve: false })
  const unrelatedTime = (await stat(join(dest, 'plain/index.html'))).mtimeMs
  const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 800))
    await domstack.settled()
  }
  await write('label.js', "export const label = 'v2'")
  await settle()
  for (const file of ['source/index.html', 'typed/index.html', 'markup/index.html', 'archive.html']) {
    assert.match(await read(file), /data-root="v2"/)
  }
  await write('root.layout.js', rootLayout.replace('data-root', 'data-updated-root'))
  await settle()
  assert.match(await read('archive.html'), /data-updated-root="v2"/)
  assert.equal((await stat(join(dest, 'plain/index.html'))).mtimeMs, unrelatedTime)

  // Import relationships also refresh when an ancestor changes its helpers.
  await write('root.layout.js', rootLayout.replace("'./label.js'", "'./other-label.js'"))
  await settle()
  await write('other-label.js', "export const label = 'alternate v2'")
  await settle()
  assert.match(await read('archive.html'), /data-root="alternate v2"/)

  // Failed builds retain the successful chain so fixing an ancestor retries it.
  await write('root.layout.js', "export const parentLayout = 'post'; export default () => ''")
  await settle()
  assert.match(await read('archive.html'), /data-root="alternate v2"/)
  await write('root.layout.js', rootLayout)
  await settle()
  assert.match(await read('archive.html'), /data-root="v2"/)

  await unlink(join(src, 'article.layout.css'))
  await settle()
  assert.doesNotMatch(await read('archive.html'), /article\.layout\.css/)
  await write('article.layout.css', 'article { color: red }')
  await settle()
  assert.match(await read('archive.html'), /article\.layout\.css/)

  await write('article.layout.js', articleLayout.replace("'root'", "'other'"))
  await settle()
  assert.match(await read('source/index.html'), /<aside>/)
  assert.doesNotMatch(await read('archive.html'), /root\.layout\.(css|client\.js)/)
  const detachedTime = (await stat(join(dest, 'archive.html'))).mtimeMs
  await write('root.layout.js', rootLayout.replace('data-root', 'data-detached-root'))
  await settle()
  assert.equal((await stat(join(dest, 'archive.html'))).mtimeMs, detachedTime, 'the former ancestor no longer rebuilds this output')
  await write('other.layout.js', "export default ({children}) => '<nav>' + children + '</nav>'")
  await settle()
  assert.match(await read('source/index.html'), /<nav>/)
  assert.match(await read('archive.html'), /<nav>/)
})

test('manual composition preserves render values, forwarded assets, and imported-parent rebuilds', { timeout: 30_000 }, async t => {
  const { domstack, src, write, read, dest } = await setup(t)
  await mkdir(join(src, 'manual'))
  await write('manual/page.ts', `
    export const vars = { layout: 'manual', title: 'Manual page' }
    export default async () => ({ html: '<p>Manual content</p>' })
  `)
  await write('manual.layout.js', `
    import rootLayout from './root.layout.js'
    export const vars = { inherited: 'manual', overridden: 'manual' }
    export default async function (args) {
      return rootLayout({ ...args, children: '<article>' + args.children.html + '</article>' })
    }
  `)
  await write('manual.layout.css', "@import './root.layout.css'; article { color: blue }")
  await write('manual.layout.client.js', "import './root.layout.client.js'; console.log('manual')")
  await write('manual.pages.js', `export default {
    outputName: 'manual-generated.html', vars: {layout: 'manual', title: 'Generated'},
    children: {html: '<p>Generated content</p>'}
  }`)
  await domstack.watch({ serve: false })
  const unrelatedTime = (await stat(join(dest, 'plain/index.html'))).mtimeMs
  assert.match(await read('manual/index.html'), /data-vars="manual:manual:Manual page"/)
  assert.match(await read('manual/index.html'), /<article>\s*<p>Manual content<\/p>/)
  assert.match(await read('manual-generated.html'), /Generated content/)
  assert.match(await read('manual/index.html'), /href="\/manual\.layout\.css"/)
  assert.match(await read('manual/index.html'), /src="\/manual\.layout\.client\.js"/)
  assert.match(await read('manual.layout.css'), /background:\s*white/)
  const manualClient = await read('manual.layout.client.js')
  const sharedClient = manualClient.match(/import "(.+)";/)?.[1]
  assert.ok(sharedClient, 'manual client retains the shared parent client import')
  assert.match(await read(sharedClient), /root/)

  await write('root.layout.js', rootLayout.replace('data-root', 'data-manual-parent'))
  await new Promise(resolve => setTimeout(resolve, 800))
  await domstack.settled()
  assert.match(await read('manual/index.html'), /data-manual-parent/)
  assert.match(await read('manual-generated.html'), /data-manual-parent/)
  assert.equal((await stat(join(dest, 'plain/index.html'))).mtimeMs, unrelatedTime)
})

test('a shared helper rebuilds layouts, pages, templates, and generated owners together', { timeout: 30_000 }, async t => {
  const { domstack, write, read } = await setup(t)
  await write('plain/page.vars.js', "import {label} from '../label.js'; export default {label}")
  await write('other.layout.js', "export default ({children, vars}) => '<aside>' + vars.label + children + '</aside>'")
  await write('label.template.js', "import {label} from './label.js'; export default () => label")
  await write('label.pages.js', "import {label} from './label.js'; export default {outputName:'label.html', children:label}")
  await domstack.watch({ serve: false })
  await write('label.js', "export const label = 'shared-v2'")
  await new Promise(resolve => setTimeout(resolve, 800))
  await domstack.settled()
  for (const file of ['source/index.html', 'plain/index.html', 'label', 'label.html']) {
    assert.match(await read(file), /shared-v2/)
  }
})

test('a browser entry point also rebuilds all of its server-side consumers', { timeout: 30_000 }, async t => {
  const { domstack, write, read, dest } = await setup(t)
  await write('global.client.js', "export const label = 'browser-v1'")
  await write('root.layout.js', rootLayout.replace('./label.js', './global.client.js'))
  await write('typed/page.ts', "import {label} from '../global.client.js'; export default () => label")
  await write('label.template.js', "import {label} from './global.client.js'; export default () => label")
  await write('label.pages.js', "import {label} from './global.client.js'; export default {outputName:'label.html', children:label}")
  await domstack.watch({ serve: false })
  const unrelatedTime = (await stat(join(dest, 'plain/index.html'))).mtimeMs
  const affectedOutputs = ['source/index.html', 'typed/index.html', 'archive.html', 'label', 'label.html', 'global.client.js']
  for (const output of affectedOutputs) assert.match(await read(output), /browser-v1/)

  await write('global.client.js', "export const label = 'browser-v2'")
  await new Promise(resolve => setTimeout(resolve, 800))
  await domstack.settled()
  for (const output of affectedOutputs) assert.match(await read(output), /browser-v2/)
  assert.equal((await stat(join(dest, 'plain/index.html'))).mtimeMs, unrelatedTime)
})

test('watch recovers from initial layout failures before any routing state exists', { timeout: 60_000 }, async t => {
  const failures = {
    render: "export default () => { throw new Error('broken render') }",
    vars: "export const vars = () => { throw new Error('broken vars') }; export default ({children}) => children",
    nonError: "export const vars = () => { throw 'broken vars' }; export default ({children}) => children",
    declaration: 'export const parentLayout = 42; export default ({children}) => children',
  }
  for (const [name, layout] of Object.entries(failures)) {
    await t.test(name, async t => {
      const { domstack, write, read, dest } = await setup(t)
      await write('root.layout.js', layout)
      const results = await domstack.watch({ serve: false })
      assert.ok(results.pageBuildResults?.errors.length, 'startup reports the layout failure without stopping watch')
      await assert.rejects(read('source/index.html'), { code: 'ENOENT' }, 'the initial failure did not produce the page')
      if (name === 'nonError') {
        const error = results.pageBuildResults?.errors[0]
        assert.ok(error instanceof Error, 'non-Error throws use the normal build error channel')
        assert.equal(error.message, 'Non-error thrown during page build')
        assert.equal(error.cause, 'broken vars', 'the original thrown value survives the worker boundary')
      }

      await write('root.layout.js', rootLayout)
      await new Promise(resolve => setTimeout(resolve, 800))
      await domstack.settled()
      for (const output of ['source/index.html', 'typed/index.html', 'markup/index.html', 'archive.html']) {
        assert.match(await read(output), /data-root="v1"/)
      }

      const unrelatedTime = (await stat(join(dest, 'plain/index.html'))).mtimeMs
      await write('label.js', "export const label = 'recovered'")
      await new Promise(resolve => setTimeout(resolve, 800))
      await domstack.settled()
      assert.match(await read('source/index.html'), /data-root="recovered"/)
      assert.match(await read('archive.html'), /data-root="recovered"/)
      assert.equal((await stat(join(dest, 'plain/index.html'))).mtimeMs, unrelatedTime, 'successful recovery restores targeted routing')
    })
  }
})

const globalData = `
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
async function setupSubscriptions (t) {
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

test('each nested renderer gets only its own subscriptions; global data can render unsubscribed inner content', async t => {
  const { domstack, read } = await setupSubscriptions(t)
  const results = await domstack.build()
  assert.equal(results.pageBuildResults?.errors.length, 0)
  for (const file of ['source/index.html', 'markup/index.html', 'typed/index.html', 'archive.html']) {
    const html = await read(file)
    assert.match(html, /nav-v1/)
    assert.match(html, /recent-v1/)
    assert.match(html, /footer-v1/)
    assert.match(html, /Content/)
  }
  assert.match(await read('typed/index.html'), /message-v1/)
})

test('watch subscribes outputs to the full layout chain and drops old ancestor subscriptions after reparenting', { timeout: 60_000 }, async t => {
  const { domstack, read, write, dest } = await setupSubscriptions(t)
  await domstack.watch({ serve: false })
  const mtime = async (/** @type {string} */ name) => (await stat(join(dest, name))).mtimeMs
  const settle = async () => {
    await new Promise(resolve => setTimeout(resolve, 800))
    await domstack.settled()
  }
  const plainTime = await mtime('plain/index.html')
  await write('source/page.md', '---\nlayout: post\n---\nChanged content')
  await settle()
  for (const file of ['markup/index.html', 'typed/index.html', 'archive.html']) {
    assert.match(await read(file), /Changed content/)
  }
  assert.equal(await mtime('plain/index.html'), plainTime)

  const archiveTime = await mtime('archive.html')
  await write('global.data.js', globalData.replace('message-v1', 'message-v2'))
  await settle()
  assert.match(await read('typed/index.html'), /message-v2/)
  assert.equal(await mtime('archive.html'), archiveTime, 'page-only data does not invalidate layouts or other pages')

  await write('global.data.js', globalData.replace('recent-v1', 'recent-v2'))
  await settle()
  assert.match(await read('archive.html'), /recent-v2/)
  assert.match(await read('markup/index.html'), /recent-v2/)

  await write('post.layout.js', `
    export const parentLayout = 'other'
    export const vars = { dataDeps: ['footer'] }
    export default ({ children, data }) => '<section>' + data.footer + children + '</section>'
  `)
  await settle()
  assert.doesNotMatch(await read('archive.html'), /nav-v1|recent-v2/)
  const detachedTime = await mtime('archive.html')
  await write('global.data.js', globalData.replace('navigation: \'nav-v1\'', 'navigation: \'nav-v2\''))
  await settle()
  assert.equal(await mtime('archive.html'), detachedTime, 'old ancestors no longer invalidate generated outputs')
  assert.equal(await mtime('plain/index.html'), plainTime)
})
