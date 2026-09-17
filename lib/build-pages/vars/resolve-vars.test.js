import { test } from 'node:test'
import assert from 'node:assert'
import { resolve } from 'path'

import { resolveVars } from './resolve-vars.js'

const __dirname = import.meta.dirname

test.describe('resolve-vars', () => {
  test('resolve vars resolves vars', async () => {
    const varsPath = resolve(__dirname, '../../../test-cases/general-features/src/globals/global.vars.js')

    const vars = await resolveVars({ varsPath })

    // @ts-ignore
    assert.equal(vars.foo, 'global')
  })
})
