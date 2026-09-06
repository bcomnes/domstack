import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

const tsconfigPaths = [
  'static-mpa-offline/tsconfig.json',
  'static-mpa-workbox-offline/tsconfig.json',
]

test('offline example TypeScript configs extend existing files', async () => {
  for (const relativePath of tsconfigPaths) {
    const tsconfigPath = path.join(import.meta.dirname, relativePath)
    const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'))
    const extendedPath = path.resolve(path.dirname(tsconfigPath), tsconfig.extends)

    await assert.doesNotReject(
      access(extendedPath),
      `${relativePath} should extend an existing TypeScript config`
    )
  }
})
