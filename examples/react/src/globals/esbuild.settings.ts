/**
 * Custom ESBuild settings for React with TypeScript.
 *
 * This file opts into React for TSX transformation and runtime.
 */
import type { BuildOptions } from 'esbuild'

/**
 * Configure ESBuild settings for React with TypeScript support.
 *
 * @param esbuildSettings - The default ESBuild configuration
 * @returns The modified ESBuild configuration
 */
export default async function esbuildSettingsOverride(esbuildSettings: BuildOptions): Promise<BuildOptions> {
  // Use React's automatic JSX runtime.
  esbuildSettings.jsx = 'automatic'
  esbuildSettings.jsxImportSource = 'react'

  return esbuildSettings
}
