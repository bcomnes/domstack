import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveBlogAuthor, type AuthorId } from '../../site/lib/authors.ts'
import { context, directory, postParts, reportError, requireAbsent, type BlogOptions } from './shared.ts'

export interface CreatePostOptions extends BlogOptions { author?: AuthorId }

export async function createPost (title: string, options: CreatePostOptions = {}): Promise<string> {
  const author = resolveBlogAuthor(options.author, 'Create post').id
  title = title.trim()
  if (!title || [...title].some(character => {
    const code = character.codePointAt(0)!
    return code < 0x20 || code === 0x7f
  })) throw new Error('Provide a nonempty, single-line post title.')
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug) throw new Error('The title must contain at least one ASCII letter or number.')
  const { blogDir, year, iso } = context(options)
  postParts(slug, year)
  await directory(blogDir, '.', false)
  const yearDir = await directory(blogDir, year, true)
  const postDir = join(yearDir, slug)
  await mkdir(postDir)
  const draft = join(postDir, 'page.draft.md')
  await requireAbsent(join(postDir, 'page.md'))
  await mkdir(join(postDir, 'img'))
  const heading = title.replace(/[[]|[\\`*_{}\]< >#!|~&]/g, character => character === ' ' ? ' ' : `\\${character}`)
  await writeFile(draft, `---\nlayout: blog\nauthor: ${author}\ndescription: "A short summary of this post."\npublishDate: "${iso}"\n---\n\n# ${heading}\n\n<!-- Draft: replace the summary above and write your post here before publishing. -->\n`, { encoding: 'utf8', flag: 'wx' })
  return draft
}

export const CREATE_HELP = 'Usage: npm run new-blogpost -- [--author bret|bcomnes] "Post title"\nCreates blog/<current-UTC-year>/<slug>/page.draft.md and img/. Author defaults to bret.'

export function parseCreateArgs (args: string[]): { help: true } | { help: false; title: string; author: AuthorId } {
  let parsed
  try { parsed = parseArgs({ args, allowPositionals: true, options: { author: { type: 'string' }, help: { type: 'boolean', short: 'h' } } }) } catch { throw new Error(CREATE_HELP) }
  if (parsed.values.help) return { help: true }
  if (parsed.positionals.length !== 1) throw new Error(CREATE_HELP)
  return { help: false, title: parsed.positionals[0]!, author: resolveBlogAuthor(parsed.values.author, 'Create post').id }
}

if (import.meta.main) {
  try {
    const args = parseCreateArgs(process.argv.slice(2))
    if (args.help) console.log(CREATE_HELP)
    else { const draft = await createPost(args.title, { author: args.author }); console.log(`Draft created: ${draft}`) }
  } catch (error) { reportError(error) }
}
