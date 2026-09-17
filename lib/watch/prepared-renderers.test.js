/**
 * @import { TestContext } from 'node:test'
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, writeFile, access, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import pino from 'pino'
import { DomStack } from '../../index.js'
import { startWatch, editAndWait } from './test-helpers.js'

/** @param {TestContext} t @param {Record<string, string>} files */
async function setup (t, files) {
  const root = await mkdtemp(join(tmpdir(), 'domstack-prepared-renderers-'))
  const src = join(root, 'src')
  const dest = join(root, 'public')
  const site = new DomStack(src, dest, { static: true, domstackManifest: false, logger: pino({ level: 'silent' }) })
  t.after(async () => {
    if (site.watching) await site.stopWatching()
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  for (const [name, content] of Object.entries({
    'global.vars.js': "export default { layout: 'root' }",
    'root.layout.js': 'export default ({ children }) => children',
    ...files,
  })) {
    const path = join(src, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  return { site, src, read: (/** @type {string} */ name) => readFile(join(dest, name), 'utf8') }
}

/** @param {string} path */
async function waitForFile (path) {
  const deadline = performance.now() + 10_000
  while (await access(path).then(() => false, () => true)) {
    assert.ok(performance.now() < deadline, `Timed out waiting for ${path}`)
    await delay(10)
  }
}

test('a source edit during producer execution uses the current snapshot then a fresh renderer next batch', { timeout: 20_000 }, async t => {
  const { site, src, read } = await setup(t, {
    'page.md': '# Original',
    'global.data.js': `import { existsSync } from 'node:fs'
      import { writeFile, unlink, appendFile } from 'node:fs/promises'
      import { setTimeout } from 'node:timers/promises'
      const control = import.meta.dirname + '/../'
      export default async ({ pages }) => {
        if (existsSync(control + '.block')) {
          await unlink(control + '.block')
          await writeFile(control + '.started', '')
          while (!existsSync(control + '.release')) await setTimeout(10)
        }
        const page = pages.find(page => page.pageInfo.type === 'md')
        const first = await page.renderInnerPage()
        const second = await page.renderInnerPage()
        await appendFile(control + '.renders', JSON.stringify([first, second]) + '\\n')
        return {}
      }`,
  })
  await startWatch(t, site, src)
  const control = join(src, '..')
  await writeFile(join(control, '.renders'), '')
  await writeFile(join(control, '.block'), '')
  const triggeringBuild = editAndWait(site, join(src, 'global.vars.js'), () =>
    writeFile(join(src, 'global.vars.js'), "export default { layout: 'root', title: 'trigger' }"))
  let sourceEdit = Promise.resolve()
  try {
    await waitForFile(join(control, '.started'))
    const written = Promise.withResolvers()
    sourceEdit = editAndWait(site, join(src, 'page.md'), async () => {
      try {
        await writeFile(join(src, 'page.md'), '# Changed')
        written.resolve(undefined)
      } catch (error) {
        written.reject(error)
        throw error
      }
    })
    await written.promise
  } finally {
    await writeFile(join(control, '.release'), '')
    await Promise.all([triggeringBuild, sourceEdit])
  }
  const renders = (await readFile(join(control, '.renders'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.ok(renders.length >= 2, 'the source edit triggers a subsequent build')
  assert.match(renders[0][0], />Original<\/h1>/)
  assert.equal(renders[0][0], renders[0][1], 'producer renders share the prepared source')
  assert.match(renders.at(-1)[0], />Changed<\/h1>/)
  assert.equal(renders.at(-1)[0], renders.at(-1)[1])
  assert.match(await read('index.html'), /Changed/)
})

test('watch prepares fresh renderers for imported helpers, Markdown settings, and data-only subscribers', { timeout: 20_000 }, async t => {
  const { site, src, read } = await setup(t, {
    'page.md': '# Heading',
    'markdown-it.settings.js': "export default md => { md.renderer.rules.heading_open = () => '<h2>'; md.renderer.rules.heading_close = () => '</h2>'; return md }",
    'helper.js': "export const text = 'first'",
    'article/page.js': "import { text } from '../helper.js'; export const vars = { dataDeps: ['selected'] }; export default ({ data }) => text + ':' + data.selected",
    'global.data.js': "export default { selected: 'one' }",
  })
  await startWatch(t, site, src)
  assert.match(await read('index.html'), /<h2>Heading<\/h2>/)
  assert.equal(await read('article/index.html'), 'first:one')
  await editAndWait(site, join(src, 'helper.js'), () => writeFile(join(src, 'helper.js'), "export const text = 'second'"))
  assert.equal(await read('article/index.html'), 'second:one')
  await editAndWait(site, join(src, 'global.data.js'), () => writeFile(join(src, 'global.data.js'), "export default { selected: 'two' }"))
  assert.equal(await read('article/index.html'), 'second:two')
  await editAndWait(site, join(src, 'markdown-it.settings.js'), () => writeFile(join(src, 'markdown-it.settings.js'), "export default md => { md.renderer.rules.heading_open = () => '<h3>'; md.renderer.rules.heading_close = () => '</h3>'; return md }"))
  assert.match(await read('index.html'), /<h3>Heading<\/h3>/)
})
