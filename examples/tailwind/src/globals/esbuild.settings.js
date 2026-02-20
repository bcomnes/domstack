/**
 * Tailwind CSS Integration for DOMStack
 *
 * This file configures ESBuild to process Tailwind CSS in your project.
 * It enables utility-first CSS classes that can be used directly in your HTML and components.
 */
import tailwindPlugin from 'esbuild-plugin-tailwindcss'

/**
 * @import { BuildOptions } from 'esbuild'
 */

/**
 * Configure ESBuild settings to include Tailwind CSS processing
 *
 * @param {BuildOptions} esbuildSettings - The default ESBuild configuration
 * @return {Promise<BuildOptions>} - The modified ESBuild configuration
 */
export default async function esbuildSettingsOverride (esbuildSettings) {
  // Add the Tailwind plugin to the ESBuild configuration
  esbuildSettings.plugins = [
    tailwindPlugin(),
  ]

  // You can also add other ESBuild settings as needed
  // esbuildSettings.minify = true;
  // esbuildSettings.sourcemap = true;

  return esbuildSettings
}
