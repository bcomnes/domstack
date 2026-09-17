import { test } from 'node:test'
import assert from 'node:assert'
import process from 'process'

import { fsPathToUrlPath } from './fs-path-to-url.js'

const isWin = process.platform === 'win32'

test.describe('fs-path-to-url', () => {
  test('fsPathToUrlPath works for all OS file path types', async () => {
    const tests = [
      {
        input: 'foo/bar/baz',
        expect: '/foo/bar/baz',
        note: 'unix style paths',
        winOnly: false,
      },
      {
        input: 'foo\\bar\\baz',
        expect: '/foo/bar/baz',
        note: 'windows style paths',
        winOnly: true,
      },
    ]

    for (const test of tests) {
      if (isWin && test.winOnly) {
        assert.equal(fsPathToUrlPath(test.input), test.expect, test.note)
      } else if (!isWin && !test.winOnly) {
        assert.equal(fsPathToUrlPath(test.input), test.expect, test.note)
      }
    }
  })
})
