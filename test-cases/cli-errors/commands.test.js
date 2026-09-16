/**
 * @import { TestContext } from 'node:test'
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

const bin = resolve(import.meta.dirname, '../../bin.js')
const commands = ['build', 'watch', 'serve', 'eject']
/** @type {Array<[string, string]>} */
const legacyModes = [
  ['--eject', 'eject'], ['-e', 'eject'],
  ['--watch', 'watch'], ['-w', 'watch'],
  ['--watch-only', 'watch'], ['--serve', 'serve'],
]

/** @param {TestContext} t */
async function workspace (t) {
  const cwd = await mkdtemp(join(tmpdir(), 'domstack-commands-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function cli (cwd, args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd, encoding: 'utf8', input: '', timeout: 15_000, killSignal: 'SIGKILL',
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null, result.stdout + result.stderr)
  return result
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function help (cwd, args) {
  const result = cli(cwd, args)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /\bdomstack\b/)
  assert.doesNotMatch(result.stdout, /@domstack\/static/)
  return result.stdout
}

/** @param {string} text */
function optionListing (text) {
  return text.split('\n').filter(line => /^\s+-{1,2}[a-z]/i.test(line)).join('\n')
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function invalid (cwd, args) {
  const result = cli(cwd, args)
  assert.notEqual(result.status, 0, `accepted ${args.join(' ')}`)
  assert.match(result.stderr, /\S/)
  assert.doesNotMatch(result.stdout + result.stderr, /Unhandled|\n\s+at\s|node:internal/)
  return result
}

test('root help lists commands and default build options without requiring or writing a project', async t => {
  const cwd = await workspace(t)
  const rootHelp = help(cwd, ['--help'])
  assert.equal(rootHelp, help(cwd, ['help']))
  assert.match(rootHelp, /commands/i)
  assert.match(rootHelp, /default/i)
  for (const command of commands) assert.match(rootHelp, new RegExp(`\\b${command}\\b`))
  const options = optionListing(rootHelp)
  for (const option of ['src', 'dest', 'copy', 'drafts', 'noEsbuildMeta', 'domstackManifest', 'verbose']) {
    assert.ok(options.includes(`--${option}`), `missing default build option --${option}`)
  }
  assert.doesNotMatch(options, /--(?:language|yes|eject|no-serve|port)\b/)
  assert.deepEqual(await readdir(cwd), [])
})

test('command help aliases and legacy help use the target command options without side effects', async t => {
  const cwd = await workspace(t)
  const commandHelp = new Map()
  for (const command of commands) {
    const text = help(cwd, [command, '--help'])
    commandHelp.set(command, text)
    assert.equal(text, help(cwd, ['help', command]))
    assert.equal(text, help(cwd, [command, '-h']))
    const options = optionListing(text)
    assert.match(options, /--src\b/)
    if (command === 'eject') {
      assert.match(options, /--language\b/)
      assert.match(options, /--yes\b/)
      assert.doesNotMatch(options, /--(?:dest|copy|verbose|drafts|port|no-serve)\b/)
    } else {
      assert.match(options, /--dest\b/)
      assert.doesNotMatch(options, /--(?:language|yes|eject)\b/)
    }
    if (command === 'watch') assert.match(options, /--no-serve\b/)
    else assert.doesNotMatch(options, /--no-serve\b/)
    if (command === 'serve') assert.match(options, /--port\b/)
    else assert.doesNotMatch(options, /--port\b/)
  }
  for (const [flag, command] of legacyModes) {
    assert.equal(help(cwd, [flag, '--help']), commandHelp.get(command), flag)
    assert.equal(help(cwd, ['--help', flag]), commandHelp.get(command), `help before ${flag}`)
  }
  assert.deepEqual(await readdir(cwd), [])
})

test('root and every command expose the package version without a project', async t => {
  const cwd = await workspace(t)
  const { version } = JSON.parse(await readFile(resolve(import.meta.dirname, '../../package.json'), 'utf8'))
  for (const args of [[], ...commands.map(command => [command]), ...legacyModes.map(([flag]) => [flag])]) {
    const result = cli(cwd, [...args, '--version'])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.stdout.trim(), version)
    assert.equal(result.stderr, '')
  }
  assert.deepEqual(await readdir(cwd), [])
})

for (const args of [['dev'], ['buid'], ['help', 'unknown']]) {
  test(`unknown command ${args.join(' ')} has a concise error and help hint`, async t => {
    const cwd = await workspace(t)
    const result = invalid(cwd, args)
    assert.match(result.stderr, /Unknown command/i)
    assert.match(result.stderr, /domstack\s+(?:--help|help)/)
    assert.ok(result.stderr.trim().split('\n').length <= 5, result.stderr)
    assert.deepEqual(await readdir(cwd), [])
  })
}

test('options are strict, command-specific, and commands must come first', async t => {
  const cwd = await workspace(t)
  const cases = [
    ['--unknown'], ['build', '--unknown'],
    ['--language', 'js'], ['--yes'], ['--port', '3000'], ['--no-serve'],
    ['build', '--language', 'js'], ['watch', '--yes'], ['serve', '--language', 'ts'],
    ['build', '--port', '3000'], ['watch', '--port', '3000'],
    ['build', '--no-serve'], ['serve', '--no-serve'],
    ['build', '--src'], ['serve', '--port'],
    ['serve', '--port', '0'], ['serve', '--port', '65536'], ['serve', '--port', 'abc'],
    ['--src', 'src', 'build'], ['build', 'watch'],
    ['build', '--watch'], ['watch', '--watch-only'], ['serve', '--serve'], ['eject', '--eject'],
    ['--watch', '--port', '3000'], ['-w', '--yes'],
    ['--watch-only', '--language', 'js'], ['--serve', '--no-serve'],
  ]
  for (const args of cases) {
    await t.test(args.join(' '), () => { invalid(cwd, args) })
  }
  assert.deepEqual(await readdir(cwd), [])
})

test('legacy modes conflict instead of silently choosing a command', async t => {
  const cwd = await workspace(t)
  const modes = ['--eject', '--watch', '--watch-only', '--serve']
  for (const [index, mode] of modes.entries()) {
    for (const other of modes.slice(index + 1)) {
      await t.test(`${mode} ${other}`, () => { invalid(cwd, [mode, other]) })
    }
  }
  invalid(cwd, ['-e', '-w'])
  assert.deepEqual(await readdir(cwd), [])
})

test('invalid eject options are rejected before prompting, writing files, or changing dependencies', async t => {
  const cwd = await workspace(t)
  const pkg = '{"type":"module","dependencies":{"retained":"1.0.0"}}\n'
  await writeFile(join(cwd, 'package.json'), pkg)
  await mkdir(join(cwd, 'src'))
  await writeFile(join(cwd, 'src', 'page.html'), '<h1>Keep this page</h1>')
  for (const mode of ['eject', '--eject', '-e']) {
    for (const options of [['--dest', 'output'], ['--verbose'], ['--language', 'tsx']]) {
      const result = invalid(cwd, [mode, '--yes', ...options])
      assert.doesNotMatch(result.stdout + result.stderr, /Continue\?|Done ejecting/)
      assert.equal(await readFile(join(cwd, 'package.json'), 'utf8'), pkg)
      assert.deepEqual((await readdir(cwd)).sort(), ['package.json', 'src'])
      assert.deepEqual(await readdir(join(cwd, 'src')), ['page.html'])
      assert.equal(await readFile(join(cwd, 'src', 'page.html'), 'utf8'), '<h1>Keep this page</h1>')
    }
  }
})

for (const explicit of [false, true]) {
  test(`${explicit ? 'explicit build' : 'default command'} builds real HTML and exits`, async t => {
    const cwd = await workspace(t)
    const src = explicit ? 'website' : 'src'
    const dest = explicit ? 'output' : 'public'
    await mkdir(join(cwd, src))
    await writeFile(join(cwd, src, 'page.html'), '<h1>Command build fixture</h1>')
    const result = cli(cwd, explicit ? ['build', '-s', src, '-d', dest] : [])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(await readFile(join(cwd, dest, 'index.html'), 'utf8'), /<h1>Command build fixture<\/h1>/)
  })
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function startCli (cwd, args) {
  const child = spawn(process.execPath, [bin, ...args], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout: 25_000, killSignal: 'SIGKILL',
  })
  let output = ''
  let exited = false
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk })
  child.on('error', error => { output += String(error) })
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    exited = true
    resolve({ code, signal })
  }))
  return { child, closed, output: () => output, exited: () => exited }
}

/** @param {ReturnType<typeof startCli>} running */
async function stopCli (running) {
  if (running.exited()) return running.closed
  running.child.kill('SIGTERM')
  const fallback = setTimeout(() => running.child.kill('SIGKILL'), 5000)
  try {
    return await running.closed
  } finally {
    clearTimeout(fallback)
  }
}

/**
 * @param {ReturnType<typeof startCli>} running
 * @param {() => Promise<boolean>} check
 * @param {string} description
 */
async function until (running, check, description) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    assert.equal(running.exited(), false, running.output())
    if (await check()) return
    await delay(50)
  }
  assert.fail(`Timed out waiting for ${description}\n${running.output()}`)
}

/** @param {string} path */
async function outputHtml (path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  }
}

/** @param {number} [port] */
async function availablePort (port = 0) {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(undefined))
  })
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    return address.port
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)))
  }
}

/** @param {number} port */
function requestHtml (port) {
  return new Promise((resolve, reject) => {
    const request = get(`http://127.0.0.1:${port}/`, { agent: false }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode, body }))
    })
    request.on('error', reject)
    request.setTimeout(1000, () => request.destroy(new Error('HTTP request timed out')))
  })
}

test('watch --no-serve rebuilds and cleans up on SIGTERM', { timeout: 30_000 }, async t => {
  const cwd = await workspace(t)
  await mkdir(join(cwd, 'src'))
  const source = join(cwd, 'src', 'page.html')
  const output = join(cwd, 'public', 'index.html')
  await writeFile(source, '<h1>Before watch edit</h1>')
  const running = startCli(cwd, ['watch', '--no-serve'])
  try {
    await until(running, async () => (await outputHtml(output)).includes('Before watch edit'), 'initial watch build')
    await writeFile(source, '<h1>After watch edit</h1>')
    await until(running, async () => (await outputHtml(output)).includes('After watch edit'), 'watch rebuild')
    assert.doesNotMatch(running.output(), /https?:\/\/(?:localhost|127\.0\.0\.1):|\[domstack-sync\]/)
    assert.deepEqual(await stopCli(running), { code: 0, signal: null }, running.output())
    assert.match(running.output(), /Watching stopped/)
  } finally {
    await stopCli(running)
  }
})

test('serve builds once, serves production HTML on the requested port, and cleans up on SIGTERM', { timeout: 30_000 }, async t => {
  const cwd = await workspace(t)
  await mkdir(join(cwd, 'src'))
  const source = join(cwd, 'src', 'page.html')
  const output = join(cwd, 'public', 'index.html')
  await writeFile(source, '<h1>Production serve fixture</h1>')
  const port = await availablePort()
  const running = startCli(cwd, ['serve', '--port', String(port)])
  try {
    await until(running, async () => {
      try {
        return (await requestHtml(port)).status === 200
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ECONNREFUSED') return false
        throw error
      }
    }, 'HTTP server')
    const html = await readFile(output, 'utf8')
    assert.match(html, /<h1>Production serve fixture<\/h1>/)
    assert.deepEqual(await requestHtml(port), { status: 200, body: html }, 'production responses must not inject live reload')
    await writeFile(source, '<h1>Source changed after serving</h1>')
    // Give an accidental watcher time to rebuild; serve must preserve its one-shot output.
    await delay(750)
    assert.equal(await readFile(output, 'utf8'), html)
    assert.deepEqual(await requestHtml(port), { status: 200, body: html })
    assert.deepEqual(await stopCli(running), { code: 0, signal: null }, running.output())
    assert.equal(await availablePort(port), port, 'SIGTERM releases the listening port')
  } finally {
    await stopCli(running)
  }
})
