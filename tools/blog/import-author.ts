import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

export interface ImportedAuthor {
  id: string
  name: string
  url: string
}

const moduleDirectory = import.meta.dirname ?? fileURLToPath(new URL('.', import.meta.url))
export const AUTHORS_FILE = join(moduleDirectory, '../../site/lib/authors.ts')
export const IMPORT_AUTHOR_HELP = 'Usage: npm run import-blog-author -- [--update] ID "Display Name" PROFILE_URL\nAdds an author to site/lib/authors.ts. Existing entries are left unchanged unless --update is supplied.'

function validateAuthor (author: ImportedAuthor): ImportedAuthor {
  const id = author.id.trim()
  const name = author.name.trim()
  const url = author.url.trim()
  if (!/^[a-z][a-z0-9]*$/.test(id)) throw new Error('Author IDs must start with a letter and contain only lowercase letters and numbers.')
  if (!name) throw new Error('Author names must be nonempty.')
  let profile: URL
  try { profile = new URL(url) } catch { throw new Error('Author URLs must be valid HTTP(S) URLs.') }
  if (!['http:', 'https:'].includes(profile.protocol)) throw new Error('Author URLs must be valid HTTP(S) URLs.')
  return { id, name, url }
}

export async function importAuthor (input: ImportedAuthor, registryPath: string = AUTHORS_FILE, update = false): Promise<boolean> {
  const author = validateAuthor(input)
  const source = await readFile(registryPath, 'utf8')
  const entry = `  ${author.id}: { name: ${JSON.stringify(author.name)}, url: ${JSON.stringify(author.url)} },`
  const existing = new RegExp(`^  ${author.id}:.*$`, 'm')
  if (existing.test(source)) {
    if (!update) throw new Error(`Author "${author.id}" already exists; use --update to replace it.`)
    await writeFile(registryPath, source.replace(existing, entry))
    return true
  }
  const marker = /^} as const(?: satisfies Record<string, AuthorProfile>)?$/m
  if (!marker.test(source)) throw new Error(`Could not find the author registry in ${registryPath}.`)
  await writeFile(registryPath, source.replace(marker, `${entry}\n} as const satisfies Record<string, AuthorProfile>`))
  return true
}

if (import.meta.main) {
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: { help: { type: 'boolean', short: 'h' }, update: { type: 'boolean' } },
    })
    if (parsed.values.help) console.log(IMPORT_AUTHOR_HELP)
    else {
      if (parsed.positionals.length !== 3) throw new Error(IMPORT_AUTHOR_HELP)
      await importAuthor({ id: parsed.positionals[0]!, name: parsed.positionals[1]!, url: parsed.positionals[2]! }, AUTHORS_FILE, parsed.values.update === true)
      console.log(`Author imported: ${parsed.positionals[0]}`)
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
