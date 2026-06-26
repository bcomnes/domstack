/**
 * Split markdown file contents into front matter and markdown content.
 *
 * @param {string} fileContents
 * @returns {{ frontMatterUnparsed: string | null, markdownContent: string }}
 */
export function parseMdFileContents (fileContents) {
  if (!fileContents.trim().startsWith('---')) {
    return {
      frontMatterUnparsed: null,
      markdownContent: fileContents,
    }
  }

  const [/* _ */, frontMatterUnparsed, ...mdParts] = fileContents.split('---')

  return {
    frontMatterUnparsed: frontMatterUnparsed ?? '',
    markdownContent: mdParts.join('---'),
  }
}
