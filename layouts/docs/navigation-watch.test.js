import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { load } from 'cheerio'
import pino from 'pino'
import { DomStack } from '../../index.js'

test('heading and index changes refresh shared navigation; body edits leave other pages alone', { timeout: 30_000 }, async t => {
  const root = resolve(import.meta.dirname, '../..')
  const temp = await mkdtemp(join(root, '.tmp-docs-navigation-'))
  const src = join(temp, 'src')
  const dest = join(temp, 'public')
  const domstack = new DomStack(src, dest, { logger: pino({ level: 'silent' }) })
  t.after(async () => {
    if (domstack.watching) await domstack.stopWatching()
    await rm(temp, { recursive: true, force: true })
  })
  for (const file of ['global.data.ts', 'layouts/docs/navigation.js', 'layouts/docs/docs.layout.js']) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await cp(join(root, file), join(src, file))
  }
  /** @param {string} file @param {string} text */
  async function write (file, text) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await writeFile(join(src, file), text)
  }
  const index = '---\nlayout: docs\n---\n# Docs\n<div class="docs-index">\n\n- [First](first/)\n- [Second](second/)\n\n</div>'
  await write('docs/README.md', index)
  await write('docs/first/README.md', '---\nlayout: docs\n---\n# First\n\n## Original\n\nBody')
  await write('docs/second/README.md', '---\nlayout: docs\n---\n# Second\n\n## Other')
  const result = await domstack.watch({ serve: false })
  assert.equal(result.pageBuildResults?.errors.length, 0)
  const output = join(dest, 'docs/second/index.html')
  assert.match(await readFile(output, 'utf8'), /first\/#original/)

  /** @param {string} file @param {string} text */
  async function edit (file, text) {
    await write(file, text)
    await new Promise(resolve => setTimeout(resolve, 800))
    await domstack.settled()
  }
  await edit('docs/first/README.md', '---\nlayout: docs\n---\n# First\n\n## Renamed\n\n### New child\n\nBody')
  assert.match(await readFile(output, 'utf8'), /first\/#renamed/)
  assert.match(await readFile(output, 'utf8'), /first\/#new-child/)
  assert.doesNotMatch(await readFile(output, 'utf8'), /first\/#original/)
  const mtime = (await stat(output)).mtimeMs
  await edit('docs/first/README.md', '---\nlayout: docs\n---\n# First\n\n## Renamed\n\n### New child\n\nChanged body only')
  assert.equal((await stat(output)).mtimeMs, mtime, 'unchanged navigation does not invalidate another page')

  await edit('docs/README.md', index.replace('- [First](first/)\n- [Second](second/)', '- [Second](second/)\n- [First](first/)'))
  const $ = load(await readFile(output, 'utf8'))
  assert.deepEqual($('.docs-navigation summary a').map((_, a) => $(a).text()).get(), ['Second', 'First'])
  await edit('docs/README.md', index.replace('- [First](first/)\n', ''))
  assert.doesNotMatch(await readFile(output, 'utf8'), /first\/#renamed/)
})
