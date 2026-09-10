import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import test from 'node:test'
import pino from 'pino'
import { DomStack } from '../../index.js'

/**
 * @param {() => boolean} check
 */
async function until (check) {
  for (let attempt = 0; !check(); attempt++) {
    assert.ok(attempt < 200, 'watch result did not arrive')
    await setTimeout(25)
  }
}

for (const level of ['debug', 'silent']) {
  test(`watch builds once per context and respects the ${level} logger`, { timeout: 20000 }, async t => {
    const root = await mkdtemp(join(import.meta.dirname, 'logging-workspace-'))
    const src = join(root, 'src')
    const dest = join(root, 'dest')
    await mkdir(src)
    await Promise.all(Object.entries({
      'page.html': '<p>Logging fixture</p>',
      'root.layout.js': 'export default ({children}) => children',
      'global.vars.js': "export default { layout: 'root' }",
      'client.js': 'console.log("initial")',
      'service-worker.js': 'console.log("worker")',
      'asset.txt': 'static asset',
      'esbuild.settings.js': `
        export const starts = []
        export default opts => ({
          ...opts,
          plugins: [{
            name: 'count-starts',
            setup(build) {
              build.onStart(() => { starts.push(build.initialOptions.entryPoints) })
            }
          }]
        })
      `,
    }).map(([file, content]) => writeFile(join(src, file), content)))
    const settings = await import(pathToFileURL(join(src, 'esbuild.settings.js')).href)
    /** @type {Array<{level: number, msg: string, errors?: Array<{text: string, location: {file: string, lineText: string}}>}>} */
    const records = []
    const logger = pino({ level }, { write: chunk => records.push(JSON.parse(chunk)) })
    const log = t.mock.method(console, 'log', () => {})
    const error = t.mock.method(console, 'error', () => {})
    const site = new DomStack(src, dest, { logger })
    t.after(async () => {
      if (site.watching) await site.stopWatching()
      await rm(root, { recursive: true, force: true })
    })
    await site.watch({ serve: false })
    await setTimeout(300)
    assert.equal(settings.starts.length, 2, 'one browser build and one worker build, with no startup rebuild')
    if (level === 'debug') {
      assert.equal(records.filter(record => record.msg.endsWith('initial build complete')).length, 2)
      assert.ok(records.some(record => record.level === 20 && record.msg.startsWith('Copy ')))
      assert.ok(!records.some(record => record.level === 30 && record.msg.startsWith('Copy ')))
      assert.ok(records.some(record => record.msg.startsWith('Static asset watcher ready')))
    }

    await writeFile(join(src, 'client.js'), 'import "./missing-client.js"')
    await until(() => settings.starts.length >= 3)
    if (level === 'debug') {
      await until(() => records.some(record => record.msg === 'JS/CSS rebuild failed'))
      const failure = records.find(record => record.msg === 'JS/CSS rebuild failed')
      assert.match(failure?.errors?.[0]?.text ?? '', /missing-client/)
      assert.match(failure?.errors?.[0]?.location.lineText ?? '', /import/)
    } else {
      await setTimeout(300)
    }
    await writeFile(join(src, 'client.js'), 'console.log("recovered")')
    await until(() => settings.starts.length >= 4)
    if (level === 'debug') {
      await until(() => records.some(record => record.msg === 'JS/CSS rebuild complete'))
    }
    await writeFile(join(src, 'service-worker.js'), 'console.log("updated worker")')
    await until(() => settings.starts.length >= 5)
    if (level === 'debug') {
      await until(() => records.some(record => record.msg === 'Service worker rebuild complete'))
    }
    await site.stopWatching()
    if (level === 'silent') assert.deepEqual(records, [])
    assert.equal(log.mock.callCount(), 0, 'watch output must not bypass the logger')
    assert.equal(error.mock.callCount(), 0, 'watch errors must not bypass the logger')
  })
}
