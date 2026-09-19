export interface AuthorProfile {
  name: string
  url: string
}

/** Author metadata used by layouts, feeds, and blog frontmatter. */
export const authors = {
  oro: { name: 'Oro Computer', url: 'https://oro.computer' },
  joe: { name: 'Joseph Werle', url: 'https://github.com/jwerle' },
  bret: { name: 'Bret Comnes', url: 'https://bret.io' },
  bcomnes: { name: 'Bret Comnes', url: 'https://bret.io' },
} as const satisfies Record<string, AuthorProfile>

export type AuthorId = keyof typeof authors
export type BlogAuthor = AuthorProfile & { id: AuthorId }

export function resolveBlogAuthor (value: unknown, source: string): BlogAuthor {
  const id = value === undefined ? 'bret' : value
  if (typeof id !== 'string' || !Object.hasOwn(authors, id)) {
    throw new Error(`${source}: unknown author ${String(id)} (expected ${Object.keys(authors).join(', ')})`)
  }
  return { id: id as AuthorId, ...authors[id as AuthorId] }
}
