import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import pino from 'pino'
import { DomStack } from '../../../index.js'

test('heading changes refresh shared navigation; body edits leave other pages alone', { timeout: 30_000 }, async t => {
  const root = resolve(import.meta.dirname, '../../..')
  const temp = await mkdtemp(join(root, '.tmp-docs-navigation-'))
  const src = join(temp, 'src')
  const dest = join(temp, 'public')
  const domstack = new DomStack(src, dest, { logger: pino({ level: 'silent' }) })
  t.after(async () => {
    if (domstack.watching) await domstack.stopWatching()
    await rm(temp, { recursive: true, force: true })
  })
  for (const file of [
    'site/globals/global.data.ts',
    'site/layouts/docs/navigation.js',
    'site/layouts/docs/docs.layout.js',
    'site/layouts/root/root.layout.js',
  ]) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await cp(join(root, file), join(src, file))
  }
  /** @param {string} file @param {string} text */
  async function write (file, text) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await writeFile(join(src, file), text)
  }
  const index = '---\nlayout: docs\ndataDeps: [docsIndexHtml]\n---\n# Docs\n\n{{{ data.docsIndexHtml }}}'
  const first = '---\nlayout: docs\ndocsOrder: 10\n---\n# First\n\n## Original\n\nBody'
  await write('docs/README.md', index)
  await write('docs/first/README.md', first)
  await write('docs/second/README.md', '---\nlayout: docs\ndocsOrder: 20\n---\n# Second\n\n## Other')
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
  const renamed = first.replace('## Original', '## Renamed')
  await edit('docs/first/README.md', renamed)
  const contents = await readFile(output, 'utf8')
  assert.match(contents, /first\/#renamed/)
  assert.doesNotMatch(contents, /first\/#original/)
  const mtime = (await stat(output)).mtimeMs
  const bodyEdited = renamed.replace('Body', 'Changed body only')
  await edit('docs/first/README.md', bodyEdited)
  assert.match(await readFile(join(dest, 'docs/first/index.html'), 'utf8'), /Changed body only/)
  assert.equal((await stat(output)).mtimeMs, mtime, 'unchanged navigation does not invalidate another page')
})
