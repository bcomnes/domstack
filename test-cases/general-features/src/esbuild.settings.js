/**
 * @param {import('esbuild').BuildOptions} esbuildSettings
 * @returns {Promise<import('esbuild').BuildOptions>}
 */
export default async function esbuildSettingsOverride (esbuildSettings) {
  esbuildSettings.jsx = 'automatic'
  esbuildSettings.jsxImportSource = 'preact'

  return esbuildSettings
}
