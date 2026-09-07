/**
 * @import { TemplateInfo } from '../../identify-pages.js'
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { templateBuilder } from './template-builder.js'
import { WatchDependencyTracker } from '../watch-dependencies.js'

test('template builder rejects malformed output shapes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'domstack-template-builder-'))
  const dest = join(root, 'public')
  t.after(async () => await rm(root, { recursive: true, force: true }))

  const cases = [
    {
      name: 'single output',
      source: 'export default async () => ({ outputName: 42, content: "invalid" })',
    },
    {
      name: 'output array',
      source: 'export default async () => [{ outputName: "invalid.txt", content: 42 }]',
    },
    {
      name: 'async iterable output',
      source: 'export default async function * () { yield { outputName: "invalid.txt", content: 42 } }',
    },
  ]

  for (const [index, fixture] of cases.entries()) {
    await t.test(fixture.name, async () => {
      const filepath = join(root, `invalid-${index}.template.mjs`)
      await writeFile(filepath, fixture.source)
      const template = /** @type {TemplateInfo} */ ({
        templateFile: {
          filepath,
          relname: `invalid-${index}.template.mjs`,
        },
        path: '',
        outputName: `invalid-${index}.txt`,
      })

      await assert.rejects(
        templateBuilder({
          dest,
          globalVars: {},
          globalData: {},
          template,
          watchDependencyTracker: new WatchDependencyTracker(null, {
            fullBuild: true,
            enabled: false,
          }),
        }),
        /Template file returned unknown return type/
      )
    })
  }
})
