import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = normalize(fileURLToPath(new URL('../public/', import.meta.url)))
const port = Number.parseInt(process.env.PORT ?? '3001', 10)

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400)
    response.end('Bad request')
    return
  }

  try {
    const filePath = await resolveFilePath(request.url)
    if (!filePath) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    response.writeHead(200, headersFor(filePath))
    createReadStream(filePath).pipe(response)
  } catch (err) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(err instanceof Error ? err.message : String(err))
  }
})

server.listen(port, () => {
  console.info(`[domstack-workbox-pwa] serving public/ on http://localhost:${port}`)
  console.info('[domstack-workbox-pwa] reset service workers and caches with /?reset-sw=1')
})

/**
 * @param {string} requestUrl
 */
async function resolveFilePath (requestUrl) {
  const url = new URL(requestUrl, `http://localhost:${port}`)
  const pathname = decodeURIComponent(url.pathname)
  const requestedPath = normalize(join(publicDir, pathname))
  if (!requestedPath.startsWith(`${publicDir}${sep}`) && requestedPath !== publicDir) return null

  const candidates = pathname.endsWith('/')
    ? [join(requestedPath, 'index.html')]
    : [requestedPath, join(requestedPath, 'index.html')]

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate
  }

  return null
}

/**
 * @param {string} filePath
 */
async function isFile (filePath) {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

/**
 * @param {string} filePath
 */
function headersFor (filePath) {
  return {
    'cache-control': filePath.endsWith('/service-worker.js')
      ? 'no-store'
      : 'public, max-age=0, must-revalidate',
    'content-type': contentTypeFor(filePath),
  }
}

/**
 * @param {string} filePath
 */
function contentTypeFor (filePath) {
  switch (extname(filePath)) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.map':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}
