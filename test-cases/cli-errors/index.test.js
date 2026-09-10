import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import test from 'node:test'

const bin = resolve(import.meta.dirname, '../../bin.js')

for (const mode of ['build', 'watch']) {
  test(`CLI ${mode} failures print complete diagnostic arrays and locations`, async t => {
    const root = await mkdtemp(join(import.meta.dirname, '.tmp-cli-errors-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const src = join(root, 'src')
    await mkdir(src)
    await writeFile(join(src, 'page.md'), '# CLI diagnostics\n')
    // Exceed util.inspect's default 100-item array limit as well as its depth limit.
    const imports = Array.from({ length: 101 }, (_, index) => `import './missing-${index}.js'`)
    await writeFile(join(src, 'client.js'), imports.join('\n'))

    const result = spawnSync(process.execPath, [
      bin, '--src', 'src', '--dest', 'dest',
      ...(mode === 'watch' ? ['--watch-only'] : []),
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    })

    assert.ifError(result.error)
    assert.equal(result.status, 1)
    const output = result.stdout + result.stderr
    // The one-shot handler also logs a separately formatted discovery tree.
    const diagnostic = mode === 'watch'
      ? result.stderr
      : result.stdout.slice(result.stdout.indexOf('ERROR: DomStackAggregateError:'))
    assert.match(diagnostic, /Error:/)
    assert.equal(diagnostic, stripVTControlCharacters(diagnostic), 'redirected diagnostics should not contain terminal colors')
    assert.doesNotMatch(output, /\[Array\]|\[Object\]|\.\.\. \d+ more items/)
    assert.equal(
      [...output.matchAll(/text: 'Could not resolve "\.\/missing-\d+\.js"'/g)].length,
      imports.length,
      'every structured diagnostic should be expanded, not just the esbuild summary'
    )
    assert.match(output, /lineText: "import '\.\/missing-100\.js'"/)
    if (mode === 'watch') {
      assert.match(result.stderr, /Unhandled domstack error/)
      assert.match(result.stderr, /Error starting esbuild watch context/)
      assert.match(result.stderr, /\[cause\]/)
    }
  })
}
