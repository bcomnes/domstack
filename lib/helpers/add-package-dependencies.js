import { readFile, writeFile } from 'node:fs/promises'

/**
 * Add production dependencies without normalizing unrelated package metadata.
 *
 * @param {string} packagePath
 * @param {Record<string, string>} dependencies
 */
export async function addPackageDependencies (packagePath, dependencies) {
  const source = await readFile(packagePath, 'utf8')
  const packageData = JSON.parse(source)
  const indentation = source.match(/^[\t ]+(?=")/m)?.[0] ?? '  '
  const trailingNewline = source.endsWith('\n') ? '\n' : ''

  packageData.dependencies = {
    ...packageData.dependencies,
    ...dependencies,
  }

  await writeFile(
    packagePath,
    JSON.stringify(packageData, null, indentation) + trailingNewline
  )
}
