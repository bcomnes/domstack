// The global.vars.ts file should export default either an object, function that
// returns an object or an async function that returns an object.
//
// These variables are available to every page, and have the lowest precedence.

interface GlobalVars {
  siteName: string;
  siteUrl: string;
  siteDescription: string;
  authorName: string;
  authorUrl: string;
  [key: string]: unknown;
}

export default async function (): Promise<GlobalVars> {
  return {
    siteName: 'domstack basic',
    siteUrl: 'https://example.com',
    siteDescription: 'A basic example site built with DOMStack.',
    authorName: 'Your Name',
    authorUrl: 'https://example.com',
  }
}
