/** @import { CommandName } from './options.js' */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CliUsageError, parseCliArgs } from './args.js'
import { commands } from './options.js'
import { formatCliHelp } from './help.js'

for (const args of [[], ['build']]) {
  test(`default build options: ${JSON.stringify(args)}`, () => {
    const parsed = parseCliArgs(args)
    assert.equal(parsed.command, 'build')
    assert.deepEqual({ ...parsed.values }, { src: 'src', dest: 'public', drafts: false })
    assert.equal(parsed.helpCommand, args.length ? 'build' : null)
  })
}

/** @type {Array<[string[], CommandName, boolean | undefined]>} */
const commandCases = [
  [['watch'], 'watch', undefined],
  [['watch', '--no-serve'], 'watch', true],
  [['serve'], 'serve', undefined],
  [['eject'], 'eject', undefined],
  [['--watch'], 'watch', undefined],
  [['-w'], 'watch', undefined],
  [['--watch-only'], 'watch', true],
  [['--serve'], 'serve', undefined],
  [['--eject'], 'eject', undefined],
  [['-e'], 'eject', undefined],
]
for (const [args, command, noServe] of commandCases) {
  test(`select command: ${JSON.stringify(args)}`, () => {
    const result = parseCliArgs(args)
    assert.equal(result.command, command)
    assert.equal(result.helpCommand, command)
    assert.equal(result.values['no-serve'], noServe)
    assert.equal(result.values['eject'], undefined)
    assert.equal(result.values['watch'], undefined)
    assert.equal(result.values['serve'], undefined)
    if (command === 'eject') {
      assert.equal(result.values['language'], 'js')
      assert.equal(result.values['dest'], undefined)
      assert.equal(result.values['drafts'], undefined)
    } else {
      assert.equal(result.values['language'], undefined)
    }
  })
}

test('legacy normalization preserves values, short groups, order and repeated copies', () => {
  const result = parseCliArgs(['--src', 'watch', '-wh', '--copy=--serve', '--copy', 'eject', '-dpublic', '--src=help'])
  assert.equal(result.command, 'watch')
  assert.equal(result.values['src'], 'help')
  assert.equal(result.values['dest'], 'public')
  assert.equal(result.values['help'], true)
  assert.deepEqual(result.values['copy'], ['--serve', 'eject'])
  assert.equal(parseCliArgs(['--src', 'eject']).command, 'build')
  assert.equal(parseCliArgs(['--copy=--watch']).command, 'build')
  assert.equal(parseCliArgs(['--watch', '--watch']).command, 'watch')
  assert.equal(parseCliArgs(['-eh']).command, 'eject')
  assert.equal(parseCliArgs(['--']).command, 'build')
})

for (const args of [
  ['watc'], ['toString'], ['__proto__'], ['help', 'watc'], ['help', 'build', 'extra'],
  ['--src', 'site', 'watch'], ['build', 'extra'], ['--', 'watch'], ['--', '--watch'],
  ['build', '--language', 'ts'], ['build', '--yes'], ['build', '--watch'],
  ['eject', '--dest', 'public'], ['eject', '--port', '3000'], ['eject', '--verbose'],
  ['watch', '--port', '3000'], ['serve', '--no-serve'], ['--no-serve'],
  ['--language', 'ts'], ['--yes'], ['--eject', '--dest', 'public'],
  ['--serve', '--watch'], ['--eject', '--watch'], ['--watch', '--watch-only'], ['-ew'],
  ['--watch-only', '--serve'], ['--port', '3000'], ['--serve', '--port'],
  ['--unknown'], ['build', '--src'], ['build', '--src='], ['build', '--dest='],
  ['eject', '--language', 'tsx'], ['--eject', '--language', 'tsx'],
  ['serve', '--port='], ['serve', '--port=0'], ['serve', '--port=65536'],
  ['serve', '--port=3.5'], ['serve', '--port=abc'],
]) {
  test(`reject invalid arguments: ${args.join(' ')}`, () => {
    assert.throws(() => parseCliArgs(args), CliUsageError)
  })
}

test('accept port boundaries and legacy serve options', () => {
  for (const port of ['1', '3000', '65535']) {
    assert.equal(parseCliArgs(['serve', '--port', port]).values['port'], port)
    assert.equal(parseCliArgs(['--port', port, '--serve']).values['port'], port)
  }
})

test('usage errors point to the selected command', () => {
  for (const args of [['eject', '--dest', 'public'], ['--eject', '--dest', 'public']]) {
    assert.throws(() => parseCliArgs(args), error => error instanceof CliUsageError && error.command === 'eject')
  }
})

test('root and command help routes share the same renderer', async () => {
  assert.deepEqual(parseCliArgs(['help']), { command: 'build', values: { help: true }, helpCommand: null })
  assert.equal(parseCliArgs(['--help']).helpCommand, null)
  const root = await formatCliHelp(null, '1.2.3')
  assert.match(root, /Usage: domstack \[command\] \[options\]/)
  assert.match(root, /Commands:/)
  assert.match(root, /--dest/)
  assert.doesNotMatch(root, /--language|--yes|--port|--no-serve|@domstack\/static/)
  for (const name of Object.keys(commands)) {
    const direct = parseCliArgs([name, '--help'])
    const help = parseCliArgs(['help', name])
    assert.equal(direct.helpCommand, help.helpCommand)
    assert.equal(direct.values['help'], true)
    assert.equal(await formatCliHelp(direct.helpCommand, '1.2.3'), await formatCliHelp(help.helpCommand, '1.2.3'))
    assert.equal(parseCliArgs([name, '--version']).values['version'], true)
  }
  const eject = await formatCliHelp('eject', '1.2.3')
  assert.match(eject, /Warning: overwrites/)
  assert.match(eject, /--language/)
  assert.doesNotMatch(eject, /--dest|--port|--verbose/)
  assert.equal((eject.match(/default: "js"/g) ?? []).length, 1)
})
