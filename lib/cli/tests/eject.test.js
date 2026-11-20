/** @import { TestContext } from 'node:test' */

import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const exec = promisify(execFile)
const project = resolve(import.meta.dirname, '../../..')
const bin = join(project, 'bin.js')
const integrationManifest = JSON.parse(await readFile(join(project, 'eject-deps/package.json'), 'utf8'))

/** @param {TestContext} t */
async function presetSite (t, type = 'module', source = 'src') {
  const cwd = await mkdtemp(join(tmpdir(), 'domstack-eject-preset-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const src = join(cwd, source)
  await mkdir(src, { recursive: true })
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ type, dependencies: { retained: '1.0.0' }, devDependencies: { retainedDev: '2.0.0' } }))
  await writeFile(join(src, 'page.html'), '<h1 class="text-red-500">Preset site</h1>')
  await symlink(join(project, 'node_modules'), join(cwd, 'node_modules'), 'dir')
  return { cwd, src }
}

for (const type of ['module', 'commonjs']) {
  for (const language of ['js', 'ts']) {
    for (const framework of ['none', 'preact', 'react']) {
      for (const css of ['mine', 'none', 'tailwind']) {
        test(`preset build: ${type}, ${language}, ${framework}, ${css}, custom src`, async t => {
          const source = 'website/content'
          const { cwd, src } = await presetSite(t, type, source)
          const args = [bin, 'eject', '--yes', '--src', source, '--language', language, '--framework', framework, '--css', css]
          await exec(process.execPath, args, { cwd, timeout: 30000 })
          const extension = type === 'module' ? language : language === 'ts' ? 'mts' : 'mjs'
          const settingsPath = join(src, `globals/esbuild.settings.${extension}`)
          if (framework !== 'none' || css === 'tailwind') {
            assert.match(await readFile(settingsPath, 'utf8'), /export default function esbuildSettingsOverride/)
            // Identical generated settings are safe to reuse.
            await exec(process.execPath, args, { cwd, timeout: 30000 })
          } else {
            await assert.rejects(readFile(settingsPath), { code: 'ENOENT' })
          }
          if (framework !== 'none') {
            const clientExtension = language === 'ts' ? 'tsx' : 'jsx'
            const entry = framework === 'react' ? "import { createRoot } from 'react-dom/client'\n" : "import { render } from 'preact'\n"
            const mount = framework === 'react' ? 'createRoot(container).render(<Counter />)' : 'render(<Counter />, container)'
            await writeFile(join(src, `client.${clientExtension}`), `${entry}
function Counter () { return <button>Preset counter</button> }
const container = document.getElementById('counter')
if (container) ${mount}
`)
          }
          const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))
          assert.equal(pkg.dependencies.retained, '1.0.0')
          assert.equal(pkg.devDependencies.retainedDev, '2.0.0')
          assert.ok(pkg.dependencies.fragtml)
          assert.equal(Boolean(pkg.dependencies['mine.css']), css === 'mine')
          assert.equal(Boolean(pkg.dependencies['highlight.js']), css === 'mine')
          assert.equal(pkg.dependencies.preact, framework === 'preact' ? integrationManifest.dependencies.preact : undefined)
          assert.equal(pkg.devDependencies['esbuild-plugin-tailwindcss'], css === 'tailwind' ? integrationManifest.devDependencies['esbuild-plugin-tailwindcss'] : undefined)
          await exec(process.execPath, [bin, 'build', '--src', source], { cwd, timeout: 30000 })
          const html = await readFile(join(cwd, 'public/index.html'), 'utf8')
          assert.match(html, /Preset site/)
          assert.doesNotMatch(html, /dom-stack-defaults|default\.style/)
          const outputs = await readdir(join(cwd, 'public'), { recursive: true })
          const styles = (await Promise.all(outputs.filter(path => path.endsWith('.css')).map(path => readFile(join(cwd, 'public', path), 'utf8')))).join('\n')
          if (css === 'tailwind') assert.match(styles, /\.text-red-500/)
          else if (css === 'mine') assert.match(styles, /mine-layout/)
          else assert.equal(styles.replace(/\/\*[\s\S]*?\*\//g, '').trim(), '')
          if (framework !== 'none') {
            const scripts = (await Promise.all(outputs.filter(path => path.endsWith('.js')).map(path => readFile(join(cwd, 'public', path), 'utf8')))).join('\n')
            assert.match(scripts, /Preset counter/)
          }
        })
      }
    }
  }
}

for (const location of ['globals/esbuild.settings.js', 'esbuild.settings.mjs', 'nested/esbuild.settings.cts']) {
  test(`settings conflict at ${location} fails before any mutations`, async t => {
    const { cwd, src } = await presetSite(t)
    const settingsPath = join(src, location)
    await mkdir(join(settingsPath, '..'), { recursive: true })
    await writeFile(settingsPath, 'export default settings => settings\n')
    await mkdir(join(src, 'layouts'), { recursive: true })
    await mkdir(join(src, 'globals'), { recursive: true })
    const sentinels = ['layouts/root.layout.js', 'globals/global.css', 'globals/global.client.js']
    for (const path of sentinels) await writeFile(join(src, path), 'Keep this customization')
    const pkg = await readFile(join(cwd, 'package.json'), 'utf8')
    await assert.rejects(exec(process.execPath, [bin, 'eject', '--yes', '--framework', 'preact'], { cwd, timeout: 30000 }), /Existing esbuild settings conflict/)
    assert.equal(await readFile(join(cwd, 'package.json'), 'utf8'), pkg)
    assert.equal(await readFile(settingsPath, 'utf8'), 'export default settings => settings\n')
    for (const path of sentinels) assert.equal(await readFile(join(src, path), 'utf8'), 'Keep this customization')
    if (location !== 'globals/esbuild.settings.js') await assert.rejects(readFile(join(src, 'globals/esbuild.settings.js')), { code: 'ENOENT' })
  })
}

test('plain eject retains settings and dependencies from previous integrations', async t => {
  const { cwd, src } = await presetSite(t)
  await mkdir(join(src, 'globals'))
  const settings = 'export default settings => settings\n'
  await writeFile(join(src, 'globals/esbuild.settings.js'), settings)
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ type: 'module', dependencies: { react: '^19.0.0' }, devDependencies: { 'esbuild-plugin-tailwindcss': '2.2.0' } }))
  await exec(process.execPath, [bin, 'eject', '--yes'], { cwd, timeout: 30000 })
  assert.equal(await readFile(join(src, 'globals/esbuild.settings.js'), 'utf8'), settings)
  const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies.react, '^19.0.0')
  assert.equal(pkg.devDependencies['esbuild-plugin-tailwindcss'], '2.2.0')
})

for (const args of [['--css', 'invalid'], ['--framework', 'vue'], ['--tailwind']]) {
  test(`invalid preset leaves project unchanged: ${args.join(' ')}`, async t => {
    const { cwd, src } = await presetSite(t)
    const pkg = await readFile(join(cwd, 'package.json'), 'utf8')
    await assert.rejects(exec(process.execPath, [bin, 'eject', '--yes', ...args], { cwd, timeout: 30000 }))
    assert.equal(await readFile(join(cwd, 'package.json'), 'utf8'), pkg)
    assert.deepEqual(await readdir(src), ['page.html'])
  })
}

for (const mode of ['eject', '--eject']) {
  for (const type of ['module', 'commonjs']) {
    for (const language of [undefined, 'js', 'ts']) {
      test(`${mode} ${language ?? 'default'} into ${type} package and build`, async t => {
        const cwd = await mkdtemp(join(tmpdir(), 'domstack-eject-'))
        t.after(() => rm(cwd, { recursive: true, force: true }))
        await writeFile(join(cwd, 'package.json'), JSON.stringify({ type, dependencies: { retained: '1.0.0' } }))
        await mkdir(join(cwd, 'src'))
        await writeFile(join(cwd, 'src/page.html'), '<h1>Ejected site</h1>')
        await symlink(join(project, 'node_modules'), join(cwd, 'node_modules'), 'dir')
        const args = [bin, mode, '--yes', ...(language ? ['--language', language] : [])]
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
}

test('eject still asks for confirmation and respects a declined prompt', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'domstack-eject-prompt-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const pkg = '{"type":"module"}'
  await writeFile(join(cwd, 'package.json'), pkg)
  await mkdir(join(cwd, 'src'))
  const result = spawnSync(process.execPath, [bin, 'eject'], {
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
  await assert.rejects(exec(process.execPath, [bin, 'eject', '--yes', '--language', 'tsx'], { cwd, timeout: 30000 }), /--language must be ts or js/)
  assert.equal(await readFile(join(cwd, 'package.json'), 'utf8'), pkg)
  await assert.rejects(readFile(join(cwd, 'src/layouts/root.layout.js')), { code: 'ENOENT' })
})
