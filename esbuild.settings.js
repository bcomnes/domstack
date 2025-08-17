/**
 * @import { BuildOptions } from '.'
 */

/**
  *
  * @param {BuildOptions} esbuildSettings
  * @returns Promise<BuildOptions>
  */
export default async function esbuildSettingsOverride (esbuildSettings) {
  // Configure loader for TTF font files
  esbuildSettings.loader = {
    ...esbuildSettings.loader,
    '.ttf': 'copy'
  }

  return esbuildSettings
}
