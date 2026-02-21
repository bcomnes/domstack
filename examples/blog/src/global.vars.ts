export interface SiteVars {
  siteName: string
  siteDescription: string
  homePageUrl: string
  authorName: string
  authorUrl: string
  authorBio: string
  [key: string]: unknown
}

export default async function (): Promise<SiteVars> {
  return {
    siteName: 'The Domstack Blog',
    siteDescription: 'A blog built with domstack, demonstrating layouts, global data, and feeds.',
    homePageUrl: 'https://example.com',
    authorName: 'Ada Lovelace',
    authorUrl: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
    authorBio: 'Mathematician and writer, widely regarded as the first computer programmer.',
  }
}
