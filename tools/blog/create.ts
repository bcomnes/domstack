import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveBlogAuthors } from '../../site/lib/authors.ts'
import { context, directory, postParts, reportError, requireAbsent, type BlogOptions } from './shared.ts'

export interface CreatePostOptions extends BlogOptions { authors?: string[] }

export async function createPost (title: string, options: CreatePostOptions = {}): Promise<string> {
  const authors = (await resolveBlogAuthors(options.authors ?? ['bcomnes'], 'Create post')).map(author => author.username)
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
  await writeFile(draft, `---\nlayout: blog\ntitle: ${JSON.stringify(title)}\nauthors: ${JSON.stringify(authors)}\ndescription: "A short summary of this post."\npublishDate: "${iso}"\n---\n\n<!-- Draft: replace the summary above and write your post here before publishing. -->\n`, { encoding: 'utf8', flag: 'wx' })
  return draft
}

export const CREATE_HELP = 'Usage: npm run new-blogpost -- [--author username] [--author username] "Post title"\nCreates blog/<current-UTC-year>/<slug>/page.draft.md and img/. Authors default to bcomnes.'

export async function parseCreateArgs (args: string[]): Promise<{ help: true } | { help: false; title: string; authors: string[] }> {
  let parsed
  try { parsed = parseArgs({ args, allowPositionals: true, options: { author: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } } }) } catch { throw new Error(CREATE_HELP) }
  if (parsed.values.help) return { help: true }
  if (parsed.positionals.length !== 1) throw new Error(CREATE_HELP)
  const authors = (await resolveBlogAuthors(parsed.values.author ?? ['bcomnes'], 'Create post')).map(author => author.username)
  return { help: false, title: parsed.positionals[0]!, authors }
}

if (import.meta.main) {
  try {
    const args = await parseCreateArgs(process.argv.slice(2))
    if (args.help) console.log(CREATE_HELP)
    else { const draft = await createPost(args.title, { authors: args.authors }); console.log(`Draft created: ${draft}`) }
  } catch (error) { reportError(error) }
}
