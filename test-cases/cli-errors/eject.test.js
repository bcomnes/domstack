import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const exec = promisify(execFile)
const project = resolve(import.meta.dirname, '../..')
const bin = join(project, 'bin.js')

for (const type of ['module', 'commonjs']) {
  for (const language of [undefined, 'js', 'ts']) {
    test(`eject ${language ?? 'default'} into ${type} package and build`, async t => {
      const cwd = await mkdtemp(join(tmpdir(), 'domstack-eject-'))
      t.after(() => rm(cwd, { recursive: true, force: true }))
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ type, dependencies: { retained: '1.0.0' } }))
      await mkdir(join(cwd, 'src'))
      await writeFile(join(cwd, 'src/page.html'), '<h1>Ejected site</h1>')
      await symlink(join(project, 'node_modules'), join(cwd, 'node_modules'), 'dir')
      const args = [bin, '--eject', '--yes', ...(language ? ['--language', language] : [])]
      const { stdout } = await exec(process.execPath, args, { cwd, timeout: 30000 })
      assert.match(stdout, /Done ejecting files!/)
      assert.doesNotMatch(stdout, /Continue\?/)
      const extension = language === 'ts' ? (type === 'module' ? 'ts' : 'mts') : type === 'module' ? 'js' : 'mjs'
      const layout = await readFile(join(cwd, `src/layouts/root.layout.${extension}`), 'utf8')
      const canonical = await readFile(join(project, 'lib/defaults/default.root.layout.ts'), 'utf8')
      assert.equal(layout, language === 'ts'
        ? canonical.replace("from '#types'", "from '@domstack/static/types.js'")
        : await readFile(join(project, 'lib/defaults/default.root.layout.js'), 'utf8'))
      assert.doesNotMatch(layout, /#types/)
      assert.equal(await readFile(join(cwd, `src/globals/global.client.${language === 'ts' ? 'ts' : extension}`), 'utf8'),
        await readFile(join(project, 'lib/defaults/default.client.js'), 'utf8'))
      assert.equal(await readFile(join(cwd, 'src/globals/global.css'), 'utf8'),
        await readFile(join(project, 'lib/defaults/default.style.css'), 'utf8'))
      const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))
      assert.equal(pkg.dependencies.retained, '1.0.0')
      for (const dependency of ['mine.css', 'fragtml', 'highlight.js']) {
        assert.ok(pkg.dependencies[dependency])
      }
      await exec(process.execPath, [bin], { cwd, timeout: 30000 })
      assert.match(await readFile(join(cwd, 'public/index.html'), 'utf8'), /<h1>Ejected site<\/h1>/)
    })
  }
}

test('eject still asks for confirmation and respects a declined prompt', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'domstack-eject-prompt-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const pkg = '{"type":"module"}'
  await writeFile(join(cwd, 'package.json'), pkg)
  await mkdir(join(cwd, 'src'))
  const result = spawnSync(process.execPath, [bin, '--eject'], {
    cwd, input: 'n\n', encoding: 'utf8', timeout: 30000,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Continue\?/)
  assert.match(result.stdout, /No action taken/)
  assert.equal(await readFile(join(cwd, 'package.json'), 'utf8'), pkg)
  await assert.rejects(readFile(join(cwd, 'src/layouts/root.layout.js')), { code: 'ENOENT' })
})

test('invalid eject language fails without changing the project', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'domstack-eject-invalid-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const pkg = '{"type":"module"}'
  await writeFile(join(cwd, 'package.json'), pkg)
  await assert.rejects(exec(process.execPath, [bin, '--eject', '--yes', '--language', 'tsx'], { cwd, timeout: 30000 }), /--language must be ts or js/)
  assert.equal(await readFile(join(cwd, 'package.json'), 'utf8'), pkg)
  await assert.rejects(readFile(join(cwd, 'src/layouts/root.layout.js')), { code: 'ENOENT' })
})
