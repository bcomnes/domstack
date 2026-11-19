import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { generateEjectDependencies } from '../../scripts/build-defaults.js'

test('checked-in eject dependency data matches the workspace manifest', async () => {
  const source = await readFile(new URL('../../eject-deps/package.json', import.meta.url), 'utf8')
  const generated = await readFile(new URL('./eject-deps.json', import.meta.url), 'utf8')
  assert.equal(generated, generateEjectDependencies(source))
})

test('eject dependency generation keeps declared ranges and strips package metadata', () => {
  const generated = generateEjectDependencies(JSON.stringify({
    name: '@domstack/eject-dependencies',
    version: '0.0.0',
    private: true,
    dependencies: { react: '^19.1.1', preact: '^10.29.6' },
    devDependencies: { '@types/react': '^19.1.10' },
    scripts: { test: 'must not be included' },
  }))
  assert.equal(generated, `${JSON.stringify({
    '@types/react': '^19.1.10',
    preact: '^10.29.6',
    react: '^19.1.1',
  }, null, 2)}\n`)
})
