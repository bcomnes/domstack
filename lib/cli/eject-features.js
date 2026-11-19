/**
 * @typedef {'js' | 'ts'} Language
 * @typedef {'none' | 'preact' | 'react'} Framework
 * @typedef {'mine' | 'tailwind' | 'none'} Css
 * @typedef {{ language?: Language, framework?: Framework, css?: Css, module?: boolean }} EjectFeaturesOptions
 */

import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const mineStyle = readFileSync(new URL('../defaults/default.style.css', import.meta.url), 'utf8')

// Generated at build time from the Dependabot-maintained eject-deps workspace.
const versions = JSON.parse(readFileSync(new URL('../defaults/eject-deps.json', import.meta.url), 'utf8'))

/**
 * Generate source-relative integration files without writing or installing anything.
 * `module` defaults to true; false selects .mjs/.mts settings for non-ESM packages.
 * @param {EjectFeaturesOptions} [options]
 */
export function ejectFeatures ({ language = 'js', framework = 'none', css = 'mine', module = true } = {}) {
  if (!['js', 'ts'].includes(language)) throw new Error('--language must be ts or js')
  if (!['none', 'preact', 'react'].includes(framework)) throw new Error('--framework must be none, preact or react')
  if (!['mine', 'tailwind', 'none'].includes(css)) throw new Error('--css must be mine, tailwind or none')

  /** @type {Record<string, string>} */
  const files = {
    'globals/global.css': css === 'mine'
      ? mineStyle
      : css === 'tailwind' ? '@import "tailwindcss" source("../");\n' : '/* No global styles. */\n',
  }
  /** @type {Record<string, string>} */
  const dependencies = { fragtml: pkg.dependencies.fragtml }
  /** @type {Record<string, string>} */
  const devDependencies = {}

  if (css === 'mine') {
    dependencies['mine.css'] = pkg.dependencies['mine.css']
    dependencies['highlight.js'] = pkg.dependencies['highlight.js']
  }
  if (framework === 'preact') dependencies['preact'] = versions.preact
  if (framework === 'react') {
    dependencies['react'] = versions.react
    dependencies['react-dom'] = versions['react-dom']
    if (language === 'ts') {
      devDependencies['@types/react'] = versions['@types/react']
      devDependencies['@types/react-dom'] = versions['@types/react-dom']
    }
  }
  if (css === 'tailwind') devDependencies['esbuild-plugin-tailwindcss'] = versions['esbuild-plugin-tailwindcss']

  if (framework !== 'none' || css === 'tailwind') {
    const extension = module ? language : language === 'ts' ? 'mts' : 'mjs'
    const typeImport = language === 'ts'
      ? "import type { BuildOptions } from '@domstack/static/types.js'\n"
      : "/** @import { BuildOptions } from '@domstack/static/types.js' */\n"
    const pluginImport = css === 'tailwind' ? "import tailwindPlugin from 'esbuild-plugin-tailwindcss'\n" : ''
    const annotation = language === 'js' ? '/** @param {BuildOptions} settings */\n' : ''
    const parameter = language === 'ts' ? 'settings: BuildOptions' : 'settings'
    const returnType = language === 'ts' ? ': BuildOptions' : ''
    const jsxSettings = framework === 'none'
      ? ''
      : `  settings.jsx = 'automatic'
  settings.jsxImportSource = '${framework}'
`
    const pluginSettings = css === 'tailwind' ? '  settings.plugins = [...(settings.plugins ?? []), tailwindPlugin()]\n' : ''
    files[`globals/esbuild.settings.${extension}`] = `${typeImport}${pluginImport}
${annotation}export default function esbuildSettingsOverride (${parameter})${returnType} {
${jsxSettings}${pluginSettings}  return settings
}
`
  }

  return { files, dependencies, devDependencies }
}
