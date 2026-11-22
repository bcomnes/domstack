/** @import { Socket } from 'node:net' */

import { lstat, mkdir } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'

import { join } from 'node:path'

const connectTimeout = 1000
const rebuildTimeout = 120_000
const maxMessageLength = 4096

export class WatchControlError extends Error {
  /** @override */
  name = 'WatchControlError'
}

/** @param {string} id @param {boolean} create */
export async function watchControlPath (id, create = false) {
  const uid = process.getuid?.()
  if (uid === undefined) throw new WatchControlError('Watch rebuild control is not available on this platform')
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new WatchControlError('Invalid watch session ID')
  // Use a short, shared root independent of each process's TMPDIR.
  const directory = join('/tmp', `dsw-${uid}`)
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
    throw new WatchControlError(`Watch control directory must be private: ${directory}`)
  }
  // Keep paths short enough for the Unix socket address limit on macOS.
  const name = Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url')
  const path = join(directory, name)
  if (Buffer.byteLength(path) >= 104) throw new WatchControlError('Temporary directory path is too long for watch control')
  return path
}

/** @param {Socket} socket @returns {Promise<Record<string, unknown>>} */
function readMessage (socket) {
  return new Promise((resolve, reject) => {
    let data = ''
    /** @param {string} chunk */
    function read (chunk) {
      data += chunk
      if (data.length > maxMessageLength) {
        cleanup()
        reject(new WatchControlError('Watch control message is too large'))
        return
      }
      const end = data.indexOf('\n')
      if (end < 0) return
      cleanup()
      try {
        const message = JSON.parse(data.slice(0, end))
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Expected an object')
        resolve(message)
      } catch (error) {
        reject(new WatchControlError('Invalid watch control message', { cause: error }))
      }
    }
    function closed () {
      cleanup()
      reject(new WatchControlError('Watch control connection closed without a response'))
    }
    /** @param {Error} error */
    function failed (error) {
      cleanup()
      reject(error)
    }
    function cleanup () {
      socket.off('data', read)
      socket.off('close', closed)
      socket.off('error', failed)
    }
    socket.setEncoding('utf8')
    socket.on('data', read)
    socket.once('close', closed)
    socket.once('error', failed)
  })
}

/** @param {unknown} error */
function errorMessage (error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

/**
 * @param {string} id
 * @param {() => Promise<void>} rebuild
 * @returns {Promise<() => Promise<void>>}
 */
export async function startWatchControl (id, rebuild) {
  const path = await watchControlPath(id, true)
  /** @type {Set<Socket>} */
  const connections = new Set()
  const server = createServer(socket => {
    connections.add(socket)
    socket.once('close', () => connections.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(connectTimeout, () => socket.destroy())
    handle(socket)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve(undefined)
    })
  })
  server.unref()

  /** @param {Socket} socket */
  async function handle (socket) {
    try {
      const message = await readMessage(socket)
      socket.setTimeout(0)
      if (message['id'] !== id || message['command'] !== 'rebuild') {
        throw new WatchControlError('Watch session or command does not match')
      }
      await rebuild()
      socket.end('{"ok":true}\n')
    } catch (error) {
      if (!socket.destroyed) socket.end(`${JSON.stringify({ ok: false, error: errorMessage(error) })}\n`)
    }
  }

  return async () => {
    const deadline = setTimeout(() => {
      for (const socket of connections) socket.destroy()
    }, connectTimeout).unref()
    try {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)))
    } finally {
      clearTimeout(deadline)
    }
  }
}

/** @param {string} id */
export async function requestWatchRebuild (id) {
  /** @type {Socket | undefined} */
  let socket
  try {
    const path = await watchControlPath(id, false)
    const connection = createConnection(path)
    socket = connection
    connection.on('error', () => {})
    connection.setTimeout(connectTimeout, () => connection.destroy(new WatchControlError('Watch control connection timed out')))
    const response = readMessage(connection)
    connection.once('connect', () => {
      connection.removeAllListeners('timeout')
      connection.setTimeout(rebuildTimeout, () => connection.destroy(new WatchControlError('Watch rebuild timed out')))
      connection.write(`${JSON.stringify({ id, command: 'rebuild' })}\n`)
    })
    const message = await response
    if (message['ok'] !== true) {
      throw new WatchControlError(typeof message['error'] === 'string' ? message['error'] : 'Watch rebuild failed')
    }
  } catch (error) {
    if (error instanceof WatchControlError) throw error
    throw new WatchControlError(`Could not reach watch session ${id}: ${errorMessage(error)}`, { cause: error })
  } finally {
    socket?.destroy()
  }
}
