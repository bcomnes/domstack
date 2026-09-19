import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { importAuthor } from './import-author.ts'

test('imports new authors and requires an explicit update for existing IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'domstack-authors-'))
  const registry = join(directory, 'authors.ts')
  await writeFile(registry, 'export interface AuthorProfile { name: string; url: string }\nexport const authors = {\n  bret: { name: \'Bret Comnes\', url: \'https://bret.io\' },\n} as const satisfies Record<string, AuthorProfile>\n')
  try {
    await importAuthor({ id: 'ada', name: 'Ada Lovelace', url: 'https://example.com/ada' }, registry)
    assert.match(await readFile(registry, 'utf8'), /ada: \{ name: "Ada Lovelace", url: "https:\/\/example\.com\/ada" \}/)
    await assert.rejects(importAuthor({ id: 'ada', name: 'Different Ada', url: 'https://example.com/different' }, registry), /already exists/)
    await importAuthor({ id: 'ada', name: 'Different Ada', url: 'https://example.com/different' }, registry, true)
    assert.match(await readFile(registry, 'utf8'), /ada: \{ name: "Different Ada", url: "https:\/\/example\.com\/different" \}/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
