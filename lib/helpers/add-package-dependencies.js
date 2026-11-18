import { readFile, writeFile } from 'node:fs/promises'

/**
 * Add production and development dependencies without normalizing unrelated package metadata.
 *
 * @param {string} packagePath
 * @param {Record<string, string>} dependencies
 * @param {Record<string, string>} [devDependencies]
 */
export async function addPackageDependencies (packagePath, dependencies, devDependencies = {}) {
  const source = await readFile(packagePath, 'utf8')
  const packageData = JSON.parse(source.replace(/^\uFEFF/, ''))
  const indentation = source.match(/^[\t ]+(?=")/m)?.[0] ?? '  '
  const trailingNewline = source.endsWith('\n') ? '\n' : ''

  packageData.dependencies = {
    ...packageData.dependencies,
    ...dependencies,
  }

  if (Object.keys(devDependencies).length) {
    packageData.devDependencies = {
      ...packageData.devDependencies,
      ...devDependencies,
    }
  }

  await writeFile(
    packagePath,
    JSON.stringify(packageData, null, indentation) + trailingNewline
  )
}
