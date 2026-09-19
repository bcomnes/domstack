export const authors = {
  bret: { name: 'Bret Comnes', url: 'https://bret.io' },
  bcomnes: { name: 'Bret Comnes', url: 'https://bret.io' },
} as const

export type AuthorId = keyof typeof authors
export type BlogAuthor = { id: AuthorId; name: string; url: string }

export function resolveBlogAuthor (value: unknown, source: string): BlogAuthor {
  const id = value === undefined ? 'bret' : value
  if (typeof id !== 'string' || !Object.hasOwn(authors, id)) {
    throw new Error(`${source}: unknown author ${String(id)} (expected bret or bcomnes)`)
  }
  return { id: id as AuthorId, ...authors[id as AuthorId] }
}
