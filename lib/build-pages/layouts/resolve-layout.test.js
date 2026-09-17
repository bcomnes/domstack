import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveLayout } from './resolve-layout.js'

test('resolves layout vars exports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'domstack-resolve-layout-vars-test-'))
  const layoutFile = join(dir, 'test.layout.mjs')

  try {
    await writeFile(layoutFile, `export const vars = async () => ({ fromLayout: 'layout vars' })
export default function layout ({ children }) { return String(children) }
`)

    const layout = await resolveLayout(layoutFile)
    const layoutVars = /** @type {{ fromLayout?: unknown }} */ (layout.vars)
    assert.strictEqual(layoutVars.fromLayout, 'layout vars')
    assert.strictEqual(typeof layout.render, 'function')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
