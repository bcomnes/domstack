import { mkdir, mkdtemp, lstat, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { authorRegistryDirectory, validateAuthorMeta, validateAuthorUrl, validateAuthorUsername } from '../../site/lib/authors.ts'
import type { AuthorMeta } from '../../site/lib/authors.ts'

type Request = typeof fetch

async function request (url: string, fetcher: Request, token: string | undefined, limit: number, allowMissing = false): Promise<{ bytes: Buffer; type: string }> {
  const headers: Record<string, string> = { 'User-Agent': 'domstack-author-importer' }
  if (new URL(url).hostname === 'api.github.com') {
    headers['Accept'] = 'application/vnd.github+json'
    headers['X-GitHub-Api-Version'] = '2022-11-28'
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  // Never forward credentials through redirects, including API redirects.
  const response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20_000) }).catch((error: unknown) => {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : 'network failure or timeout'
    throw new Error(`${url}: ${cause}`)
  })
  if (allowMissing && response.status === 404) {
    await response.body?.cancel()
    return { bytes: Buffer.alloc(0), type: '' }
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`)
  }
  const chunks: Uint8Array[] = []
  let size = 0
  if (!response.body) throw new Error(`${url}: empty response body`)
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new Error(`${url}: response exceeds ${limit} bytes`)
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return { bytes: Buffer.concat(chunks), type: response.headers.get('content-type')?.split(';')[0]?.trim() || '' }
}

function avatarExtension (bytes: Buffer, type: string): string {
  if (type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
  if (type === 'image/gif' && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'gif'
  if (type === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp'
  throw new Error('avatar must be a PNG, JPEG, GIF, or WebP image with matching content type')
}

function publicKeys (keys: string, gpg: string): void {
  if (/PRIVATE KEY/i.test(keys + gpg)) throw new Error('refusing private key material')
  if (keys.trim() && !keys.trim().split('\n').every(line => /^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-\S+|sk-\S+) [A-Za-z0-9+/]+={0,3}(?: .*)?$/.test(line.trim()))) throw new Error('invalid public SSH keys response')
  if (gpg.trim() && !/^(?:-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----\s*)+$/.test(gpg.trim())) throw new Error('invalid public GPG keys response')
}

export async function importAuthor (input: string, options: { directory?: string; fetcher?: Request; token?: string } = {}): Promise<AuthorMeta> {
  const username = validateAuthorUsername(input.toLowerCase())
  const directory = options.directory ?? authorRegistryDirectory
  const fetcher = options.fetcher ?? fetch
  const get = (url: string, limit = 1_048_576, allowMissing = false) => request(url, fetcher, options.token, limit, allowMissing)
  const profile = JSON.parse((await get(`https://api.github.com/users/${username}`)).bytes.toString('utf8'))
  if (!profile || typeof profile.login !== 'string' || profile.login.toLowerCase() !== username || !['User', 'Organization'].includes(profile.type)) throw new Error('GitHub profile username/type mismatch')
  const social = await get(`https://api.github.com/users/${username}/social_accounts`, 1_048_576, profile.type === 'Organization')
  const accounts: unknown = social.bytes.length ? JSON.parse(social.bytes.toString('utf8')) : []
  if (!Array.isArray(accounts)) throw new Error('GitHub social_accounts must be an array')
  const links = accounts.map(account => {
    if (!account || typeof account.provider !== 'string' || !account.provider.trim()) throw new Error('invalid GitHub social account')
    return { provider: account.provider, url: validateAuthorUrl(account.url) }
  })
  if (profile.blog != null && typeof profile.blog !== 'string') throw new Error('invalid GitHub website')
  const blog = (profile.blog || '').trim()
  const website = blog ? validateAuthorUrl(/^[a-z][a-z0-9+.-]*:/i.test(blog) ? blog : `https://${blog}`) : null
  const avatarUrl = new URL(validateAuthorUrl(profile.avatar_url))
  if (avatarUrl.protocol !== 'https:' || avatarUrl.hostname !== 'avatars.githubusercontent.com' || avatarUrl.port) throw new Error('unexpected GitHub avatar host')
  const avatar = await get(avatarUrl.href, 10_485_760)
  const filename = `avatar.${avatarExtension(avatar.bytes, avatar.type)}`
  // Organizations do not own user signing keys; GitHub returns 404 for these endpoints.
  const keys = (await get(`https://github.com/${username}.keys`, 1_048_576, profile.type === 'Organization')).bytes.toString('utf8')
  const gpg = (await get(`https://github.com/${username}.gpg`, 1_048_576, profile.type === 'Organization')).bytes.toString('utf8')
  publicKeys(keys, gpg)
  const meta = validateAuthorMeta({ schemaVersion: 1, username, name: profile.name || profile.login, profile: `https://github.com/${username}`, website, links, avatar: filename, keys, gpg }, username)

  // No registry changes until every download and validation has succeeded.
  await mkdir(directory, { recursive: true })
  const lock = join(directory, `.${username}.lock`)
  await mkdir(lock).catch(() => { throw new Error(`import already running or stale lock: ${lock}`) })
  let staging: string | undefined
  const destination = join(directory, username)
  const backup = join(lock, 'previous')
  let backedUp = false
  try {
    staging = await mkdtemp(join(directory, `.${username}-`))
    await writeFile(join(staging, filename), avatar.bytes)
    await writeFile(join(staging, 'author-meta.json'), JSON.stringify(meta, null, 2) + '\n')
    const existing = await lstat(destination).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('existing author path must be a real directory')
      await rename(destination, backup)
      backedUp = true
    }
    try {
      await rename(staging, destination)
    } catch (error) {
      if (backedUp) { await rename(backup, destination); backedUp = false }
      throw error
    }
    backedUp = false
    return meta
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true })
    // Preserve the backup if restoration itself failed.
    if (!backedUp) await rm(lock, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: npm run import-author -- <github-username>')
    const meta = await importAuthor(process.argv[2]!, { token: process.env['GITHUB_TOKEN'] })
    console.log(`Imported ${meta.username}: ${meta.name}; ${meta.links.length} social links; SSH keys ${meta.keys.trim() ? 'present' : 'empty'}; GPG keys ${meta.gpg.trim() ? 'present' : 'empty'}`)
  } catch (error) {
    // Do not print request headers, credentials, or upstream response bodies.
    console.error(`Author import failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    process.exitCode = 1
  }
}
