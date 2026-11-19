import { link, lstat, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dump, load } from 'js-yaml'
import { context, directory, postParts, reportError, requireAbsent, type BlogOptions } from './shared.ts'

export function updatePublishDate (content: string, now: Date): string {
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(content)
  if (!match) throw new Error('Draft must start with YAML frontmatter delimited by --- lines.')
  let metadata: unknown
  try { metadata = load(match[2]!) } catch { throw new Error('Draft frontmatter is not valid YAML.') }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Draft frontmatter must be a YAML mapping.')
  const updated = { ...metadata, publishDate: now.toISOString() }
  const newline = match[1]!.includes('\r\n') ? '\r\n' : '\n'
  const yaml = dump(updated, { lineWidth: -1, forceQuotes: true }).trimEnd().replace(/\n/g, newline)
  return `${match[1]}${yaml}${match[3]}${content.slice(match[0].length)}`
}

export async function publishDraft (input: string, options: BlogOptions = {}): Promise<string> {
  const { blogDir, year, iso } = context(options)
  const [postYear, slug] = postParts(input, year)
  const yearDir = await directory(blogDir, postYear, false)
  const postDir = await directory(yearDir, slug, false)
  const draft = join(postDir, 'page.draft.md')
  const published = join(postDir, 'page.md')
  await requireAbsent(published)
  const stat = await lstat(draft)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Draft must be a regular file, not a symbolic link.')
  const content = updatePublishDate(await readFile(draft, 'utf8'), new Date(iso))
  const temporary = join(postDir, `.publish-${randomUUID()}.tmp`)
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: stat.mode })
  try { await link(temporary, published); await unlink(draft) } finally { await unlink(temporary) }
  return published
}

export const PUBLISH_HELP = 'Usage: npm run publish-draft -- [year/]slug\nA bare slug uses the current UTC year. For older drafts, use year/slug.'

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) console.log(PUBLISH_HELP)
  else if (args.length !== 1 || args[0]!.startsWith('-')) reportError(new Error(PUBLISH_HELP))
  else try { console.log(`Draft published: ${await publishDraft(args[0]!)}`) } catch (error) { reportError(error) }
}
