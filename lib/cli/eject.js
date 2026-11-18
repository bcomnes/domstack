/** @import { EjectFeaturesOptions } from './eject-features.js' */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import readline from 'node:readline'
import { packageDirectory } from 'package-directory'
import { addPackageDependencies } from '../helpers/add-package-dependencies.js'
import { askYesNo } from '../helpers/cli-prompt.js'
import { CliUsageError } from './args.js'
import { ejectFeatures } from './eject-features.js'

/**
 * Check all settings locations, not just the generated filename: DOMStack finds
 * these files anywhere under src and otherwise warns and picks the first one.
 * @param {string} src
 * @param {string} target
 * @param {string} content
 */
async function checkSettings (src, target, content) {
  /** @param {string} directory */
  async function visit (directory) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') await visit(path)
      } else if (/^esbuild\.settings\.(?:[mc]?[jt]s)$/.test(entry.name)) {
        if (path !== target || await readFile(path, 'utf8') !== content) {
          throw new CliUsageError(`Existing esbuild settings conflict at ${path}. Move or reconcile them before ejecting; no files were changed.`, 'eject')
        }
      }
    }
  }
  await visit(src)
}

/**
 * @param {EjectFeaturesOptions & { src: string, yes?: boolean }} options
 */
export async function eject ({ src, yes = false, language = 'js', framework = 'none', css = 'mine' }) {
  src = resolve(src)
  const packageRoot = await packageDirectory({ cwd: src })
  if (!packageRoot) throw new CliUsageError("Can't locate package.json, exiting without making changes", 'eject')
  const packagePath = join(packageRoot, 'package.json')
  const pkg = JSON.parse((await readFile(packagePath, 'utf8')).replace(/^\uFEFF/, ''))
  const isModule = pkg.type === 'module'
  const { files, dependencies, devDependencies } = ejectFeatures({ language, framework, css, module: isModule })
  const extension = isModule ? language : language === 'ts' ? 'mts' : 'mjs'
  const layoutSource = await readFile(new URL(`../defaults/default.root.layout.${language}`, import.meta.url), 'utf8')
  files[`layouts/root.layout.${extension}`] = language === 'ts'
    ? layoutSource.replace("from '#types'", "from '@domstack/static/types.js'")
    : layoutSource
  files[`globals/global.client.${language === 'ts' ? 'ts' : extension}`] = await readFile(new URL('../defaults/default.client.js', import.meta.url), 'utf8')

  const settings = Object.entries(files).find(([path]) => path.startsWith('globals/esbuild.settings.'))
  if (settings) await checkSettings(src, join(src, settings[0]), settings[1])

  console.log(`\ndomstack eject actions:\n${[
    ...Object.keys(files).map(path => `  - Write ${relative(process.cwd(), join(src, path))}`),
    ...Object.entries(dependencies).map(([name, version]) => `  - Add ${name}@${version} to ${relative(process.cwd(), packagePath)}`),
    ...Object.entries(devDependencies).map(([name, version]) => `  - Add ${name}@${version} to devDependencies in ${relative(process.cwd(), packagePath)}`),
  ].join('\n')}\n`)

  if (!yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    let answer
    try {
      answer = await askYesNo(rl, 'Continue?')
    } finally {
      rl.close()
    }
    if (!answer) {
      console.log('No action taken. Exiting.')
      return
    }
  }

  for (const [path, content] of Object.entries(files)) {
    const target = join(src, path)
    await mkdir(dirname(target), { recursive: true })
    // Settings are never overwritten, even if they appear after preflight.
    if (path.startsWith('globals/esbuild.settings.')) {
      try {
        await writeFile(target, content, { flag: 'wx' })
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST' || await readFile(target, 'utf8') !== content) throw error
      }
    } else {
      await writeFile(target, content)
    }
  }
  await addPackageDependencies(packagePath, dependencies, devDependencies)
  console.log('Done ejecting files!')
}
