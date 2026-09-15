// The global.vars.ts file should export default either an object, function that
// returns an object or an async function that returns an object.
//
// These variables are available to every page, and have the lowest precedence.

export default async function globalVars () {
  return {
    siteName: 'domstack basic',
    locale: 'en' as const,
    theme: 'dark' as const,
    navigation: [
      { label: 'Home', href: '/' },
      { label: 'JavaScript page', href: '/js-page/' },
    ],
  }
}
