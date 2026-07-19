import { test } from 'node:test'
import assert from 'node:assert'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { DomStack } from '../../index.js'

const __dirname = import.meta.dirname

test('template outputs cannot escape dest', async (t) => {
  const src = path.join(__dirname, './src')
  const dest = path.join(__dirname, './public')
  const siteUp = new DomStack(src, dest)

  t.after(async () => {
    await rm(dest, { recursive: true, force: true })
  })

  await rm(dest, { recursive: true, force: true })

  await assert.rejects(
    () => siteUp.build(),
    error => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /Build finished/)
      return true
    }
  )
})
