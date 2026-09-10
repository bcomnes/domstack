import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

test('CLI summaries are concise and --verbose restores the build tree', async t => {
  const root = await mkdtemp(join(import.meta.dirname, '.tmp-cli-logging-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'page.md'), '# Logging\n')
  for (const verbose of [false, true]) {
    const result = spawnSync(process.execPath, [
      resolve(import.meta.dirname, '../../bin.js'), '--src', 'src', '--dest', 'dest',
      ...(verbose ? ['--verbose'] : []),
    ], { cwd: root, encoding: 'utf8', timeout: 15000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /INFO: Built src → dest/)
    assert.match(result.stdout, /Build Success!/)
    if (verbose) {
      assert.match(result.stdout, /DEBUG:/)
      assert.match(result.stdout, /page.md:/)
    } else {
      assert.doesNotMatch(result.stdout, /DEBUG:|page.md:/)
    }
  }
})
