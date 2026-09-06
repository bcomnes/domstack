import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { addPackageDependencies } from './add-package-dependencies.js'

test('adds dependencies while preserving unrelated package metadata', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'domstack-package-'))
  const packagePath = path.join(directory, 'package.json')
  t.after(() => rm(directory, { recursive: true, force: true }))

  await writeFile(packagePath, '\uFEFF' + JSON.stringify({
    name: 'example',
    private: true,
    scripts: { test: 'node --test' },
    dependencies: { existing: '^1.0.0', replace: '^1.0.0' },
  }, null, '\t') + '\n')

  await addPackageDependencies(packagePath, {
    added: '^2.0.0',
    replace: '^2.0.0',
  })

  const source = await readFile(packagePath, 'utf8')
  assert.ok(source.endsWith('\n'))
  assert.match(source, /^\{\n\t"name"/)
  assert.deepEqual(JSON.parse(source), {
    name: 'example',
    private: true,
    scripts: { test: 'node --test' },
    dependencies: {
      existing: '^1.0.0',
      replace: '^2.0.0',
      added: '^2.0.0',
    },
  })
})
