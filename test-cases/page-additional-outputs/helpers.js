/**
 * @import { TestContext } from 'node:test'
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inspect } from 'node:util'
import pino from 'pino'
import { DomStack } from '../../index.js'
import { builder } from '../../lib/builder.js'

/** @param {string} root @param {Record<string, string>} files */
export async function writeFiles (root, files) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

/** @param {TestContext} t @param {Record<string, string>} files */
export async function setup (t, files) {
  const tmp = await mkdtemp(join(import.meta.dirname, '.tmp-'))
  const src = join(tmp, 'src')
  const dest = join(tmp, 'custom-output')
  await writeFiles(src, {
    'global.vars.js': "export default { layout: 'root' }",
    'root.layout.js': 'export default ({ children }) => children',
    ...files,
  })
  const logs = /** @type {string[]} */ ([])
  const options = { static: true, domstackManifest: false, logger: pino({ level: 'debug' }, { write: line => logs.push(line) }) }
  const site = new DomStack(src, dest, options)
  t.after(async () => {
    if (site.watching) await site.stopWatching()
    await rm(tmp, { recursive: true, force: true })
  })
  return {
    src,
    dest,
    site,
    logs,
    build: () => builder(src, dest, options),
    /** @param {string} name */
    read: name => readFile(join(dest, name), 'utf8'),
    /** @param {string} name */
    mtime: async name => (await stat(join(dest, name))).mtimeMs,
  }
}

/**
 * Capture the cursor before mutating sources so startup/previous builds cannot
 * satisfy the wait, even when chokidar has not detected the change yet.
 * @param {DomStack} site
 * @param {string[]} logs
 * @param {() => Promise<void>} mutate
 * @param {string} [expectedError]
 */
export async function settle (site, logs, mutate, expectedError) {
  const cursor = logs.length
  await mutate()
  const deadline = performance.now() + 10_000
  while (true) {
    const messages = logs.slice(cursor).map(line => JSON.parse(line).msg)
    if (messages.includes('Build Failed!')) {
      if (!expectedError || !messages.some(message => message.includes(expectedError))) {
        throw new Error(`Unexpected watch build failure:\n${messages.join('\n')}`)
      }
      break
    }
    if (messages.includes('Build Success!') && !expectedError) break
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for watch ${expectedError ? `failure: ${expectedError}` : 'build success'}:\n${messages.join('\n')}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  await site.settled()
  const errors = logs.slice(cursor).filter(line => JSON.parse(line).level >= 50)
  if (!expectedError && errors.length) throw new Error(`Unexpected watch errors:\n${errors.join('\n')}`)
}

/** @param {unknown} error @returns {string} */
export function errorText (error) {
  if (!(error instanceof Error)) return inspect(error, { depth: null })
  return [error.message, error.cause ? errorText(error.cause) : '',
    ...('errors' in error && Array.isArray(error.errors) ? error.errors.map(errorText) : []),
  ].join('\n')
}

/** @param {string} outputName @param {string} [content] */
export const hook = (outputName, content = 'sidecar') => `export const additionalOutputs = () => ({ outputName: ${JSON.stringify(outputName)}, content: ${JSON.stringify(content)} })`
