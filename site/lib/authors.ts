import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface BlogAuthor {
  username: string
  name: string
  url: string
  avatar: string
}

export interface AuthorMeta {
  schemaVersion: 1
  username: string
  name: string
  profile: string
  website: string | null
  links: { provider: string; url: string }[]
  avatar: string
  keys: string
  gpg: string
}

export const authorRegistryDirectory = join(import.meta.dirname, '../../authors')

export function validateAuthorUsername (value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(value) || value.includes('--')) {
    throw new Error('expected a lowercase GitHub username (1–39 letters, digits, or single hyphens)')
  }
  return value
}

function hasControlCharacters (value: string): boolean {
  return [...value].some(character => {
    const code = character.codePointAt(0)!
    return code <= 0x1f || code === 0x7f
  })
}

export function validateAuthorUrl (value: unknown): string {
  if (typeof value !== 'string' || /\s/.test(value) || hasControlCharacters(value)) throw new Error('invalid author URL')
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('author URLs must use HTTP(S) without credentials')
  }
  return url.href
}

export function validateAuthorMeta (value: unknown, username: string): AuthorMeta {
  validateAuthorUsername(username)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected author metadata object')
  const meta = value as Record<string, unknown>
  if (meta['schemaVersion'] !== 1 || meta['username'] !== username) throw new Error('author schema version or username mismatch')
  if (typeof meta['name'] !== 'string' || !meta['name'].trim() || hasControlCharacters(meta['name'])) throw new Error('invalid author name')
  if (meta['profile'] !== `https://github.com/${username}`) throw new Error('invalid GitHub profile URL')
  if (meta['website'] !== null) validateAuthorUrl(meta['website'])
  if (!Array.isArray(meta['links'])) throw new Error('expected author links array')
  for (const link of meta['links']) {
    if (!link || typeof link !== 'object' || typeof link.provider !== 'string' || !link.provider.trim()) throw new Error('invalid author link')
    validateAuthorUrl(link.url)
  }
  if (typeof meta['avatar'] !== 'string' || !/^avatar\.(png|jpg|webp|gif)$/.test(meta['avatar'])) throw new Error('invalid relative avatar filename')
  if (typeof meta['keys'] !== 'string' || typeof meta['gpg'] !== 'string' || /PRIVATE KEY/.test(meta['keys'] + meta['gpg'])) throw new Error('expected public key strings only')
  return meta as unknown as AuthorMeta
}

export class AuthorRegistry {
  readonly directory: string
  #reads = new Map<string, Promise<BlogAuthor>>()

  constructor (directory = authorRegistryDirectory) {
    this.directory = directory
  }

  get (value: string): Promise<BlogAuthor> {
    const username = validateAuthorUsername(value)
    const cached = this.#reads.get(username)
    if (cached) return cached
    const pending = this.#read(username).catch(error => {
      // A cleared, older request must not evict a newer request for this author.
      if (this.#reads.get(username) === pending) this.#reads.delete(username)
      throw error
    })
    this.#reads.set(username, pending)
    return pending
  }

  clear (username?: string): void {
    if (username === undefined) this.#reads.clear()
    else this.#reads.delete(validateAuthorUsername(username))
  }

  async resolve (value: unknown, source: string): Promise<BlogAuthor[]> {
    try {
      if (!Array.isArray(value) || value.length === 0) throw new Error('authors must be a nonempty array of registered GitHub usernames')
      const usernames = Array.from(value, validateAuthorUsername)
      if (new Set(usernames).size !== usernames.length) throw new Error('duplicate author usernames')
      return await Promise.all(usernames.map(username => this.get(username)))
    } catch (error) {
      throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async #read (username: string): Promise<BlogAuthor> {
    const directory = join(this.directory, username)
    const metaPath = join(directory, 'author-meta.json')
    try {
      const entry = await lstat(directory).catch(error => {
        if (error.code === 'ENOENT') throw new Error(`unknown author ${username}; import it with npm run import-author -- ${username}`)
        throw error
      })
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('author directory must be a real directory')
      const metadata = await lstat(metaPath)
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('metadata must be a regular file')
      const meta = validateAuthorMeta(JSON.parse(await readFile(metaPath, 'utf8')), username)
      const avatar = await lstat(join(directory, meta.avatar))
      if (!avatar.isFile() || avatar.isSymbolicLink() || !avatar.size) throw new Error('avatar must be a nonempty regular file')
      return Object.freeze({ username, name: meta.name, url: meta.website || meta.profile, avatar: `/authors/${username}/${meta.avatar}` })
    } catch (error) {
      throw new Error(`${metaPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// Shared within this module instance; workers/processes have independent caches.
export const authorRegistry = new AuthorRegistry()

export function resolveBlogAuthors (value: unknown, source: string): Promise<BlogAuthor[]> {
  return authorRegistry.resolve(value, source)
}
