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
  const { domstack, read } = await setup(t)
  const results = await domstack.build()
  assert.equal(results.pageBuildResults?.errors.length, 0)
  for (const [output, title] of [['source/index.html', 'source'], ['typed/index.html', 'typed'], ['markup/index.html', 'markup'], ['archive.html', 'archive']]) {
    const html = await read(/** @type {string} */ (output))
    assert.match(html, new RegExp(`data-vars="root:article:${title}"`))
    assert.match(html, /<article>\s*<section>/)
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
