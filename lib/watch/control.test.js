import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { requestWatchRebuild, requestWatchStop, startWatchControl, watchControlPath } from './control.js'

test('control checks the session ID and stops accepting requests after close', { skip: !process.getuid }, async () => {
  const id = randomUUID()
  let requests = 0
  const close = await startWatchControl(id, async () => { requests++ })
  try {
    const path = await watchControlPath(id)
    const reply = await new Promise((resolve, reject) => {
      const socket = createConnection(path)
      socket.once('error', reject)
      socket.setTimeout(2000, () => socket.destroy(new Error('test control response timed out')))
      socket.once('connect', () => socket.write(`${JSON.stringify({ command: 'rebuild', id: randomUUID() })}\n`))
      let result = ''
      socket.setEncoding('utf8').on('data', chunk => { result += chunk })
      socket.once('end', () => resolve(JSON.parse(result)))
    })
    assert.deepEqual(reply, { ok: false, error: 'Watch session or command does not match' })
    assert.equal(requests, 0)
    await requestWatchRebuild(id)
    assert.equal(requests, 1)
  } finally {
    await close()
  }
  await assert.rejects(requestWatchRebuild(id), /Could not reach watch session/)
})

test('an accepted stop outlives its caller timing out', { skip: !process.getuid, timeout: 5000 }, async () => {
  const id = randomUUID()
  const accepted = Promise.withResolvers()
  const release = Promise.withResolvers()
  let stopped = false
  const close = await startWatchControl(id, async () => {}, async () => {
    accepted.resolve(undefined)
    await release.promise
    stopped = true
  })
  try {
    const timedOut = assert.rejects(requestWatchStop(id, 50), /Watch stop timed out/)
    await accepted.promise
    await timedOut
    assert.equal(stopped, false)
    release.resolve(undefined)
    await setImmediate()
    assert.equal(stopped, true)
  } finally {
    release.resolve(undefined)
    await close()
  }
})
