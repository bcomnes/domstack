import { resolve } from 'node:path'
import { load } from 'cheerio'
import { expect, test } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: { ignore: ['examples', 'test-cases', 'coverage', '*.tsconfig.json', 'fonts'] },
})

// These bookmarks predate the reference split. Keep both dotted Markdown IDs
// and their older aliases, not just links currently used by the new navigation.
const movedSections = {
  pages: [
    'layouts', 'layout-module-exports', 'declaring-nested-layouts',
    'layout-variables', 'layout-render-function', 'the-default-rootlayoutts',
    'the-default-root.layout.ts', 'layout-styles', 'layout-client-bundles', 'layout-types',
  ],
  assets: [
    'globalvarsts', 'global.vars.ts', 'browser-variable', 'esbuildsettingsts',
    'esbuild.settings.ts', 'default-build-behavior', 'markdown-itsettingsts', 'markdown-it.settings.ts',
  ],
  content: [
    'global-data', 'global-data-types', 'global-data-caveats',
    'generated-pages', 'generated-pages-exports', 'one-page-definition',
    'page-definition-array', 'synchronous-factory', 'asynchronous-factory',
    'async-iterable', 'generated-pages-factory-parameters', 'generated-page-definitions',
    'generated-pages-types', 'templates', 'simple-string-template', 'object-template',
    'object-array-template', 'asynciterator-template', 'choosing-a-template-return-type',
    'page-data-and-introspection', 'page-metadata', 'rendering-page-content', 'rendering-many-pages',
  ],
  renderers: ['rendering-integrations', 'advanced', 'custom-layout-renderers'],
}

test('every moved reference bookmark redirects to a final destination with a real target', async ({ page, siteURL }) => {
  test.setTimeout(90_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  for (const [source, ids] of Object.entries(movedSections)) {
    const from = `${siteURL}/docs/${source}/`
    const response = await page.request.get(from)
    expect(response.status()).toBe(200)
    const $ = load(await response.text())
    for (const id of ids) {
      await test.step(`${source}/#${id}`, async () => {
        const link = $('[data-reference-url]').toArray().find(el => $(el).attr('id') === id)
        expect(link).toBeDefined()
        const href = $(link).attr('href')
        expect(href).toBe($(link).attr('data-reference-url'))
        const destination = new URL(href, from)
        await page.goto(`${from}#${id}`)
        await expect(page).toHaveURL(destination.href)
        await expect(page.locator('.docs-content h1')).toHaveText(
          /^(Layouts|Settings|Data|Generation)$/
        )
        if (destination.hash) {
          const target = await page.evaluate(hash => {
            const element = document.getElementById(hash) ?? document.getElementById(decodeURIComponent(hash))
            return { exists: !!element, redirectsAgain: element?.hasAttribute('data-reference-url') }
          }, destination.hash.slice(1))
          expect(target).toEqual({ exists: true, redirectsAgain: false })
        }
      })
    }
  }
  // Original README bookmarks should go straight to the new owner, not take
  // another hop through the now-retired sections.
  for (const [id, path] of [
    ['layout-types', '/docs/layouts/#layout-types'],
    ['global-data', '/docs/data/#global-data'],
    ['templates', '/docs/generation/#templates'],
    ['browser-variable', '/docs/settings/#browser-variable'],
    ['custom-layout-renderers', '/docs/layouts/#custom-layout-renderers'],
  ]) {
    await page.goto(`${siteURL}/#${id}`)
    await expect(page).toHaveURL(siteURL + path)
  }
  expect(errors).toEqual([])
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('retired pages and moved sections provide usable fallback links', async ({ page, siteURL }) => {
    test.setTimeout(30_000)
    for (const [source, id, target] of [
      ['pages', 'layout-types', 'layouts/#layout-types'],
      ['assets', 'esbuild.settings.ts', 'settings/#esbuild.settings.ts'],
      ['content', 'global-data', 'data/#global-data'],
      ['content', 'templates', 'generation/#templates'],
      ['renderers', 'custom-layout-renderers', 'layouts/#custom-layout-renderers'],
    ]) {
      await page.goto(`${siteURL}/docs/${source}/#${id}`)
      const link = page.locator(`a[id="${id}"]`)
      // Opening the disclosure explicitly also works on browsers that do not
      // expand a details element when navigating to a fragment inside it.
      const disclosure = page.locator('.moved-references:not([open]) > summary')
      if (await disclosure.count()) await disclosure.click()
      await link.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(`${siteURL}/docs/${target}`)
    }
  })
})
