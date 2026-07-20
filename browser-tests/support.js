import { expect, test as base } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { testBuild } from '../index.js'

const fixtureSrc = resolve(import.meta.dirname, '../test-cases/general-features/src')
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.woff2', 'font/woff2']
])

export const test = base.extend({
  siteURL: async ({ context }, use) => {
    const build = await testBuild(fixtureSrc)
    const publicDir = build.dest
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const pathname = decodeURIComponent(url.pathname)
        const relativePath = pathname.endsWith('/')
          ? `${pathname}index.html`
          : pathname
        const filePath = resolve(publicDir, `.${relativePath}`)

        if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${sep}`)) {
          response.writeHead(403).end('Forbidden')
          return
        }

        const body = await readFile(filePath)
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream'
        })
        response.end(body)
      } catch (error) {
        const status = error?.code === 'ENOENT' ? 404 : 500
        response.writeHead(status).end(status === 404 ? 'Not found' : 'Server error')
      }
    })

    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })

    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Static server did not bind to a TCP port')

    await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|$))/, route => route.abort())
    await use(`http://127.0.0.1:${address.port}`)

    for (const page of context.pages()) {
      if (!page.isClosed()) await page.close().catch(() => {})
    }

    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
    await build.cleanup()
  }
})

export { expect }
