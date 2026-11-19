/**
 * @import { Language, Framework, Css } from './eject-features.js'
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { ESLint } from 'eslint'
import { neostandard } from 'neostandard'
import { CliUsageError, parseCliArgs } from './args.js'
import { ejectFeatures } from './eject-features.js'

const integrationManifest = JSON.parse(await readFile(new URL('../../eject-deps/package.json', import.meta.url), 'utf8'))
const versions = { ...integrationManifest.dependencies, ...integrationManifest.devDependencies }

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: neostandard({ ts: true, filesTs: ['**/*.{ts,mts}'] }) })

for (const language of /** @type {Language[]} */ (['js', 'ts'])) {
  for (const framework of /** @type {Framework[]} */ (['none', 'preact', 'react'])) {
    for (const css of /** @type {Css[]} */ (['mine', 'tailwind', 'none'])) {
      for (const module of [true, false]) {
        test(`pure eject features: ${language}, ${framework}, ${css}, module=${module}`, async () => {
          const options = { language, framework, css, module }
          const result = ejectFeatures(options)
          assert.deepEqual(result, ejectFeatures(options))
          const { files, dependencies, devDependencies } = result
          assert.ok(dependencies['fragtml'])
          assert.equal(Boolean(dependencies['mine.css']), css === 'mine')
          assert.equal(Boolean(dependencies['highlight.js']), css === 'mine')
          assert.equal(dependencies['preact'], framework === 'preact' ? versions.preact : undefined)
          assert.equal(dependencies['react'], framework === 'react' ? versions.react : undefined)
          assert.equal(dependencies['react-dom'], framework === 'react' ? versions['react-dom'] : undefined)
          assert.equal(devDependencies['@types/react'], framework === 'react' && language === 'ts' ? versions['@types/react'] : undefined)
          assert.equal(devDependencies['@types/react-dom'], framework === 'react' && language === 'ts' ? versions['@types/react-dom'] : undefined)
          assert.equal(devDependencies['esbuild-plugin-tailwindcss'], css === 'tailwind' ? versions['esbuild-plugin-tailwindcss'] : undefined)
          if (css === 'mine') {
            assert.equal(files['globals/global.css'], await readFile(new URL('../defaults/default.style.css', import.meta.url), 'utf8'))
          } else if (css === 'tailwind') {
            assert.equal(files['globals/global.css'], '@import "tailwindcss" source("../");\n')
          } else {
            assert.equal(files['globals/global.css'], '/* No global styles. */\n')
          }
          const extension = module ? language : language === 'ts' ? 'mts' : 'mjs'
          const settings = files[`globals/esbuild.settings.${extension}`]
          assert.equal(Boolean(settings), framework !== 'none' || css === 'tailwind')
          if (settings) {
            if (framework !== 'none') assert.match(settings, new RegExp(`settings.jsxImportSource = '${framework}'`))
            if (css === 'tailwind') assert.match(settings, /settings.plugins = \[\.\.\.\(settings.plugins \?\? \[\]\), tailwindPlugin\(\)\]/)
            const results = await eslint.lintText(settings, { filePath: `esbuild.settings.${extension}` })
            assert.deepEqual(results.flatMap(result => result.messages), [])
          }
        })
      }
    }
  }
}

test('eject CSS choices and defaults work for explicit and legacy commands', () => {
  for (const mode of ['eject', '--eject']) {
    assert.equal(parseCliArgs([mode]).values['css'], 'mine')
    assert.equal(parseCliArgs([mode]).values['framework'], 'none')
    for (const css of ['mine', 'tailwind', 'none']) {
      assert.equal(parseCliArgs([mode, '--css', css]).values['css'], css)
    }
    assert.throws(() => parseCliArgs([mode, '--tailwind']), /Unknown option/)
    for (const args of [
      ['--css', 'invalid'], ['--framework', 'vue'], ['--css', ''], ['--framework', ''],

    ]) {
      assert.throws(() => parseCliArgs([mode, ...args]), CliUsageError)
    }
  }
  for (const command of ['build', 'watch', 'serve']) {
    for (const args of [['--tailwind'], ['--css', 'mine'], ['--framework', 'react']]) {
      assert.throws(() => parseCliArgs([command, ...args]), CliUsageError)
    }
  }
})

test('integration metadata is a private workspace shipped with DOMStack', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(integrationManifest.private, true)
  assert.ok(pkg.workspaces.includes('eject-deps'))
  assert.ok(pkg.files.includes('eject-deps/package.json'))
})

test('pure features reject unsupported presets', () => {
  for (const options of [{ language: 'tsx' }, { framework: 'vue' }, { css: 'bootstrap' }]) {
    // @ts-expect-error deliberately invalid options
    assert.throws(() => ejectFeatures(options))
  }
})
