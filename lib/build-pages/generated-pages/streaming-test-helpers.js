/**
 * @import { TestContext } from 'node:test'
 * @import { Results } from '../../builder.js'
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'
import { DomStack } from '../../../index.js'
import { builder } from '../../builder.js'
import { writeFiles } from '../outputs/test-helpers.js'

/** @param {TestContext} t @param {Record<string, string>} files @param {boolean} [buildDrafts] */
export async function setup (t, files, buildDrafts = false) {
  const root = await mkdtemp(join(import.meta.dirname, '.tmp-streaming-'))
  const src = join(root, 'src')
  const dest = join(root, 'custom-output')
  const logs = /** @type {string[]} */ ([])
  const options = { static: true, domstackManifest: false, buildDrafts, logger: pino({ level: 'debug' }, { write: line => logs.push(line) }) }
  const site = new DomStack(src, dest, options)
  t.after(async () => {
    if (site.watching) await site.stopWatching()
    await rm(root, { recursive: true, force: true })
  })
  await writeFiles(src, {
    'global.vars.js': `export default { layout: 'root', title: 'Global', testRoot: ${JSON.stringify(root)}, testDest: ${JSON.stringify(dest)} }`,
    'root.layout.js': "export default ({ children }) => '<main>' + children + '</main>'",
    ...files,
  })
  return {
    src,
    dest,
    root,
    site,
    logs,
    build: () => builder(src, dest, options),
    /** @param {string} name */
    read: name => readFile(join(dest, name), 'utf8'),
  }
}

/**
 * @param {Results['pageBuildResults']} result
 * @param {string} src
 * @param {string} dest
 * @param {string} outputRelname
 * @param {string} owner
 * @param {number} index
 */
export function assertReported (result, src, dest, outputRelname, owner, index) {
  assert.ok(result, 'page build results survive worker transport')
  const output = result.outputs.find(output => output.outputRelname === outputRelname)
  assert.ok(output, `${outputRelname} retains output metadata`)
  assert.equal(output.kind, 'page')
  assert.equal(output.filepath, join(dest, outputRelname))
  assert.equal(output.sourceRelname, `${owner}#${index}`)
  const report = result.report.pages.find(page => page.outputs.some(output => output.outputRelname === outputRelname))
  assert.ok(report, `${outputRelname} retains an ownership report`)
  assert.equal(report.pagesFilePath, join(src, owner))
  assert.equal(report.sourcePageFilePath, undefined)
  assert.equal(report.pageFilePath, join(dest, outputRelname))
  assert.deepEqual(report.outputs.find(record => record.outputRelname === outputRelname), output)
}
