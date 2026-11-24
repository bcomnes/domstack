import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

const draftPath = '/blog/2026/inside-the-domstack-build-and-watch-cycle/'
const publishedPath = '/blog/2026/hello-world/'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: { ...websiteOptions, buildDrafts: true },
  javaScriptEnabled: false,
})

test('draft badges appear on posts, the index and archives without marking published posts', async ({ page, siteURL }) => {
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`${siteURL}${draftPath}`)
    const badge = page.locator('.blog-article-meta .blog-draft-badge')
    await expect(badge).toHaveText('Draft')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveCSS('border-top-style', 'solid')
    await expect(badge).toHaveCSS('font-weight', '700')

    for (const path of ['/blog/', '/blog/2026/']) {
      await page.goto(`${siteURL}${path}`)
      const draft = page.locator('.blog-list article').filter({ has: page.locator(`h2 a[href="${draftPath}"]`) })
      await expect(draft.locator('.blog-draft-badge')).toBeVisible()
      await expect(draft.locator('.blog-draft-badge')).toHaveText('Draft')
      const published = page.locator('.blog-list article').filter({ has: page.locator(`h2 a[href="${publishedPath}"]`) })
      await expect(published).toHaveCount(1)
      await expect(published.locator('.blog-draft-badge')).toHaveCount(0)
    }

    await page.goto(`${siteURL}${publishedPath}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello, DOMStack')
    await expect(page.locator('.blog-draft-badge')).toHaveCount(0)
  }
})
