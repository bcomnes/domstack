import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const project = path.resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(path.join(tmpdir(), 'domstack-version-build-'))
const generated = 'lib/defaults/default.root.layout.js'
const source = 'lib/defaults/default.root.layout.ts'

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 */
async function run (command, args, cwd = temporary) {
  const { stdout } = await exec(command, args, {
    cwd,
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_EDITOR: 'true', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  })
  return stdout.trim()
}

try {
  // Snapshot current edits and new files without touching the real index or refs.
  const files = await run('git', ['--no-pager', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], project)
  for (const file of new Set(files.split('\0').filter(Boolean))) {
    const destination = path.join(temporary, file)
    await mkdir(path.dirname(destination), { recursive: true })
    try {
      await copyFile(path.join(project, file), destination)
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error
    }
  }
  await symlink(path.join(project, 'node_modules'), path.join(temporary, 'node_modules'), 'dir')
  await run('git', ['init', '--initial-branch=main'])
  await run('git', ['config', 'user.name', 'DOMStack lifecycle test'])
  await run('git', ['config', 'user.email', 'lifecycle@example.invalid'])
  await run('git', ['remote', 'add', 'origin', 'https://github.com/bcomnes/domstack.git'])
  await rm(path.join(temporary, generated), { force: true })
  await run('git', ['add', '.'])
  await run('git', ['commit', '-m', 'Disposable initial snapshot'])

  for (const version of ['99.0.0-test.0', '99.0.0-test.1']) {
    if (version.endsWith('.1')) {
      const original = await readFile(path.join(temporary, source), 'utf8')
      await writeFile(path.join(temporary, source), original.replace("siteName = 'domstack'", "siteName = 'version-hook-test'"))
      await run('git', ['add', source])
      await run('git', ['commit', '-m', 'Change canonical source without rebuilding'])
    }
    await run('npm', ['version', version, '--no-workspaces', '--sign-git-commit=false', '--sign-git-tag=false'])
    const output = await readFile(path.join(temporary, generated), 'utf8')
    assert.equal(await run('git', ['--no-pager', 'show', `v${version}:${generated}`]), output.trim())
    const schema = await run('git', ['--no-pager', 'show', `v${version}:lib/domstack-manifest/schema.json`])
    assert.match(schema, /@domstack\/static@99\//, 'version-dependent schema is captured before the version commit')
    assert.equal(await run('git', ['--no-pager', 'rev-parse', `v${version}^{commit}`]), await run('git', ['--no-pager', 'rev-parse', 'HEAD']))
    assert.equal(await run('git', ['--no-optional-locks', 'status', '--porcelain']), '')
    if (version.endsWith('.1')) assert.match(output, /version-hook-test/)
    await run('npm', ['run', 'build:defaults'])
    await run('npm', ['run', 'build:defaults'])
    assert.equal(await readFile(path.join(temporary, generated), 'utf8'), output, 'generation is byte-for-byte idempotent')
    await run('npm', ['run', 'clean'])
    await run('npm', ['run', 'postpublish'])
    assert.equal(await readFile(path.join(temporary, generated), 'utf8'), output, 'cleanup preserves generated runtime code')
    assert.equal(await run('git', ['--no-optional-locks', 'status', '--porcelain']), '', 'version commit stays clean')
    console.log(`Verified ${version}: generated JS staged, committed, tagged, idempotent, and preserved by cleanup`)
  }
  // releasearoni builds after versioning; npm then runs prepack before publishing.
  const versionedOutput = await readFile(path.join(temporary, generated), 'utf8')
  await run('npm', ['run', 'build'])
  const packDestination = path.join(temporary, '.tmp-pack')
  await mkdir(packDestination)
  const [{ files: packedFiles }] = JSON.parse(await run('npm', ['pack', '--json', '--pack-destination', packDestination]))
  for (const required of [source, generated, 'lib/defaults/default.root.layout.d.ts']) {
    assert.ok(packedFiles.some(/** @param {{ path: string }} file */ file => file.path === required))
  }
  await run('npm', ['run', 'postpublish'])
  assert.equal(await readFile(path.join(temporary, generated), 'utf8'), versionedOutput)
  assert.equal(await run('git', ['--no-optional-locks', 'status', '--porcelain']), '', 'release build, pack, and postpublish leave the version commit clean')
  console.log('Verified release build → pack → postpublish preserves the version commit and packages both layouts and declarations')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
