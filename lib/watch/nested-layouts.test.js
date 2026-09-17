import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'
import { editAndWait, startWatch, waitForRebuild } from './test-helpers.js'
import { setup, setupSubscriptions, rootLayout, articleLayout, globalData } from '../build-pages/layouts/nested-test-helpers.js'

test('watch follows ancestor edits, imports, reparenting, and asset membership', { timeout: 60_000 }, async t => {
  const { domstack, read, write, dest, src } = await setup(t)
  await startWatch(t, domstack, src)
  const unrelatedTime = (await stat(join(dest, 'plain/index.html'))).mtimeMs
  await editAndWait(domstack, join(src, 'label.js'), () => write('label.js', "export const label = 'v2'"))
  for (const file of ['source/index.html', 'typed/index.html', 'markup/index.html', 'archive.html']) {
    assert.match(await read(file), /data-root="v2"/)
  }
  await editAndWait(domstack, join(src, 'root.layout.js'), () => write('root.layout.js', rootLayout.replace('data-root', 'data-updated-root')))
  assert.match(await read('archive.html'), /data-updated-root="v2"/)
  assert.equal((await stat(join(dest, 'plain/index.html'))).mtimeMs, unrelatedTime)

  // Import relationships also refresh when an ancestor changes its helpers.
  await editAndWait(domstack, join(src, 'root.layout.js'), () => write('root.layout.js', rootLayout.replace("'./label.js'", "'./other-label.js'")))
  await editAndWait(domstack, join(src, 'other-label.js'), () => write('other-label.js', "export const label = 'alternate v2'"))
  assert.match(await read('archive.html'), /data-root="alternate v2"/)

  // Failed builds retain the successful chain so fixing an ancestor retries it.
  await editAndWait(domstack, join(src, 'root.layout.js'), () => write('root.layout.js', "export const parentLayout = 'post'; export default () => ''"))
  assert.match(await read('archive.html'), /data-root="alternate v2"/)
  await editAndWait(domstack, join(src, 'root.layout.js'), () => write('root.layout.js', rootLayout))
  assert.match(await read('archive.html'), /data-root="v2"/)

  await editAndWait(domstack, join(src, 'article.layout.css'), () => unlink(join(src, 'article.layout.css')))
  assert.doesNotMatch(await read('archive.html'), /article\.layout\.css/)
  await editAndWait(domstack, join(src, 'article.layout.css'), () => write('article.layout.css', 'article { color: red }'))
  assert.match(await read('archive.html'), /article\.layout\.css/)

  await editAndWait(domstack, join(src, 'article.layout.js'), () => write('article.layout.js', articleLayout.replace("'root'", "'other'")))
  assert.match(await read('source/index.html'), /<aside>/)
  assert.doesNotMatch(await read('archive.html'), /root\.layout\.(css|client\.js)/)
  const detachedTime = (await stat(join(dest, 'archive.html'))).mtimeMs
  await editAndWait(domstack, join(src, 'root.layout.js'), () => write('root.layout.js', rootLayout.replace('data-root', 'data-detached-root')))
  assert.equal((await stat(join(dest, 'archive.html'))).mtimeMs, detachedTime, 'the former ancestor no longer rebuilds this output')
  await editAndWait(domstack, join(src, 'other.layout.js'), () => write('other.layout.js', "export default ({children}) => '<nav>' + children + '</nav>'"))
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
  await startWatch(t, domstack, src)
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

  await editAndWait(domstack, join(src, 'root.layout.js'), () => write('root.layout.js', rootLayout.replace('data-root', 'data-manual-parent')))
  assert.match(await read('manual/index.html'), /data-manual-parent/)
  assert.match(await read('manual-generated.html'), /data-manual-parent/)
  assert.equal((await stat(join(dest, 'plain/index.html'))).mtimeMs, unrelatedTime)
})

test('a shared helper rebuilds layouts, pages, templates, and generated owners together', { timeout: 30_000 }, async t => {
  const { domstack, src, write, read } = await setup(t)
  await write('plain/page.vars.js', "import {label} from '../label.js'; export default {label}")
  await write('other.layout.js', "export default ({children, vars}) => '<aside>' + vars.label + children + '</aside>'")
  await write('label.template.js', "import {label} from './label.js'; export default () => label")
  await write('label.pages.js', "import {label} from './label.js'; export default {outputName:'label.html', children:label}")
  await startWatch(t, domstack, src)
  await editAndWait(domstack, join(src, 'label.js'), () => write('label.js', "export const label = 'shared-v2'"))
  for (const file of ['source/index.html', 'plain/index.html', 'label', 'label.html']) {
    assert.match(await read(file), /shared-v2/)
  }
})

test('a browser entry point also rebuilds all of its server-side consumers', { timeout: 30_000 }, async t => {
  const logs = /** @type {string[]} */ ([])
  const logger = pino({ level: 'info' }, { write: line => logs.push(JSON.parse(line).msg) })
  const { domstack, src, write, read, dest } = await setup(t, logger)
  await write('global.client.js', "export const label = 'browser-v1'")
  await write('root.layout.js', rootLayout.replace('./label.js', './global.client.js'))
  await write('typed/page.ts', "import {label} from '../global.client.js'; export default () => label")
  await write('label.template.js', "import {label} from './global.client.js'; export default () => label")
  await write('label.pages.js', "import {label} from './global.client.js'; export default {outputName:'label.html', children:label}")
  await startWatch(t, domstack, src)
  const unrelatedTime = (await stat(join(dest, 'plain/index.html'))).mtimeMs
  const affectedOutputs = ['source/index.html', 'typed/index.html', 'archive.html', 'label', 'label.html', 'global.client.js']
  for (const output of affectedOutputs) assert.match(await read(output), /browser-v1/)

  const cursor = logs.length
  await editAndWait(domstack, join(src, 'global.client.js'), () => write('global.client.js', "export const label = 'browser-v2'"))
  await waitForRebuild(logs, cursor, 'JS/CSS rebuild complete')
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
      const { domstack, src, write, read, dest } = await setup(t)
      await write('root.layout.js', layout)
      const results = await startWatch(t, domstack, src)
      assert.ok(results.pageBuildResults?.errors.length, 'startup reports the layout failure without stopping watch')
      await assert.rejects(read('source/index.html'), { code: 'ENOENT' }, 'the initial failure did not produce the page')
      if (name === 'nonError') {
        const error = results.pageBuildResults?.errors[0]
        assert.ok(error instanceof Error, 'non-Error throws use the normal build error channel')
        assert.equal(error.message, 'Non-error thrown during page build')
        assert.equal(error.cause, 'broken vars', 'the original thrown value survives the worker boundary')
      }

      await editAndWait(domstack, join(src, 'root.layout.js'), () => write('root.layout.js', rootLayout))
      for (const output of ['source/index.html', 'typed/index.html', 'markup/index.html', 'archive.html']) {
        assert.match(await read(output), /data-root="v1"/)
      }

      const unrelatedTime = (await stat(join(dest, 'plain/index.html'))).mtimeMs
      await editAndWait(domstack, join(src, 'label.js'), () => write('label.js', "export const label = 'recovered'"))
      assert.match(await read('source/index.html'), /data-root="recovered"/)
      assert.match(await read('archive.html'), /data-root="recovered"/)
      assert.equal((await stat(join(dest, 'plain/index.html'))).mtimeMs, unrelatedTime, 'successful recovery restores targeted routing')
    })
  }
})

test('manual composition forwards declared data and rebuilds source and generated subscribers', { timeout: 30_000 }, async t => {
  const { domstack, src, dest, read, write } = await setupSubscriptions(t)
  await mkdir(join(src, 'manual'))
  await write('manual/page.ts', `
    export const vars = { layout: 'manual', dataDeps: ['pageMessage'] }
    export default ({ data }) => '<p>' + data.pageMessage + '</p>'
  `)
  await write('manual.layout.js', `
    import root from './root.layout.js'
    export const vars = { dataDeps: ['navigation', 'rendered'] }
    export default args => root({ ...args, children: '<article>' + args.children + '</article>' })
  `)
  await write('manual.pages.js', `export default {
    outputName: 'manual-generated.html', vars: { layout: 'manual', dataDeps: ['pageMessage'] },
    children: ({ data }) => '<p>' + data.pageMessage + '</p>'
  }`)
  await startWatch(t, domstack, src)
  const plainTime = (await stat(join(dest, 'plain/index.html'))).mtimeMs
  let currentData = globalData
  for (const [before, after, message] of /** @type {const} */ ([
    ['nav-v1', 'manual-nav-v2', 'message-v1'],
    ['message-v1', 'manual-message-v2', 'manual-message-v2'],
  ])) {
    currentData = currentData.replace(before, after)
    await editAndWait(domstack, join(src, 'global.data.js'), () => write('global.data.js', currentData))
    for (const file of ['manual/index.html', 'manual-generated.html']) {
      assert.match(await read(file), /manual-nav-v2/)
      assert.match(await read(file), new RegExp(`<article>\\s*<p>${message}</p>`))
    }
  }
  assert.equal((await stat(join(dest, 'plain/index.html'))).mtimeMs, plainTime)
})

test('watch subscribes outputs to the full layout chain and drops old ancestor subscriptions after reparenting', { timeout: 60_000 }, async t => {
  const { domstack, src, read, write, dest } = await setupSubscriptions(t)
  await startWatch(t, domstack, src)
  const mtime = async (/** @type {string} */ name) => (await stat(join(dest, name))).mtimeMs
  const plainTime = await mtime('plain/index.html')
  let currentData = globalData
  await editAndWait(domstack, join(src, 'source/page.md'), () => write('source/page.md', '---\nlayout: post\n---\nChanged content'))
  for (const file of ['markup/index.html', 'typed/index.html', 'archive.html']) {
    assert.match(await read(file), /Changed content/)
  }
  assert.equal(await mtime('plain/index.html'), plainTime)

  const archiveTime = await mtime('archive.html')
  currentData = currentData.replace('message-v1', 'message-v2')
  await editAndWait(domstack, join(src, 'global.data.js'), () => write('global.data.js', currentData))
  assert.match(await read('typed/index.html'), /message-v2/)
  assert.equal(await mtime('archive.html'), archiveTime, 'page-only data does not invalidate layouts or other pages')

  currentData = currentData.replace('recent-v1', 'recent-v2')
  await editAndWait(domstack, join(src, 'global.data.js'), () => write('global.data.js', currentData))
  assert.match(await read('archive.html'), /recent-v2/)
  assert.match(await read('markup/index.html'), /recent-v2/)

  await editAndWait(domstack, join(src, 'post.layout.js'), () => write('post.layout.js', `
    export const parentLayout = 'other'
    export const vars = { dataDeps: ['footer'] }
    export default ({ children, data }) => '<section>' + data.footer + children + '</section>'
  `))
  assert.doesNotMatch(await read('archive.html'), /nav-v1|recent-v2/)
  const detachedTime = await mtime('archive.html')
  currentData = currentData.replace('nav-v1', 'nav-v2')
  await editAndWait(domstack, join(src, 'global.data.js'), () => write('global.data.js', currentData))
  assert.equal(await mtime('archive.html'), detachedTime, 'old ancestors no longer invalidate generated outputs')
  assert.equal(await mtime('plain/index.html'), plainTime)
})
