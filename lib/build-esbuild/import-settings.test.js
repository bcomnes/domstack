import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { importSettings, MAX_SETTINGS_MODULE_VERSIONS } from './import-settings.js'

// This file runs in its own test process so exhausting the real process-wide
// budget cannot affect the build fixtures in other test files.
test('settings version budget includes failures and all paths but permits cached contents', async t => {
  const root = await mkdtemp(join(tmpdir(), 'domstack-settings-budget-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'esbuild.settings.mjs')
  const otherPath = join(root, 'other.settings.mjs')
  await writeFile(path, 'export default 0')
  const first = await importSettings(path)
  assert.equal(await importSettings(path), first)

  await writeFile(otherPath, 'throw new Error("intentional settings failure")')
  await assert.rejects(importSettings(otherPath), /intentional settings failure/)
  for (let i = 2; i < MAX_SETTINGS_MODULE_VERSIONS; i++) {
    await writeFile(path, `export default ${i}`)
    const [a, b] = await Promise.all([importSettings(path), importSettings(path)])
    assert.equal(a.default, i)
    assert.equal(a, b)
  }

  await writeFile(path, 'export default "over limit"')
  await assert.rejects(importSettings(path), /Restart the DOMStack process/)
  const newPath = join(root, 'new.settings.mjs')
  await writeFile(newPath, 'export default "new path over limit"')
  await assert.rejects(importSettings(newPath), /Restart the DOMStack process/)
  await assert.rejects(importSettings(otherPath), /intentional settings failure/)
  await writeFile(path, 'export default 0')
  assert.equal(await importSettings(path), first)
})
