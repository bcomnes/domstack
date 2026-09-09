import { resolve } from 'node:path'
import { expect, test } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: { ignore: ['examples', 'test-cases', 'coverage', '*.tsconfig.json', 'fonts'] },
})

for (const colorScheme of ['light', 'dark']) {
  test(`site shell works from phone to desktop in ${colorScheme} mode`, async ({ page, siteURL }) => {
    test.setTimeout(30_000)
    await page.emulateMedia({ colorScheme })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of ['/', '/docs/api/', '/docs/layouts/']) {
        await test.step(`${width}px ${path}`, async () => {
          await page.goto(siteURL + path)
          await expect(page.getByRole('banner')).toBeVisible()
          await expect(page.getByRole('main')).toHaveCount(1)
          await expect(page.getByRole('contentinfo')).toHaveCount(1)
          await expect(page.locator('main main, main header, main footer')).toHaveCount(0)
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          // Owning a root layout must not silently drop the shared base styles.
          expect(await page.locator('html').evaluate(el =>
            getComputedStyle(el).getPropertyValue('--background').trim()
          )).not.toBe('')
          const toggle = page.getByRole('button', { name: 'Open documentation menu' })
          if (path.startsWith('/docs/') && width < 1024) {
            await expect(toggle).toBeVisible()
          } else {
            await expect(toggle).toBeHidden()
          }
          const links = await page.locator('.site-header a, .site-footer a').evaluateAll(elements =>
            elements.map(el => el.href).filter(href => new URL(href).origin === location.origin)
          )
          for (const href of new Set(links)) expect((await page.request.get(href)).status()).toBe(200)
          await page.getByRole('contentinfo').scrollIntoViewIfNeeded()
          await expect(page.getByRole('contentinfo')).toBeInViewport()
          await expect(page.getByRole('banner')).toBeInViewport()
        })
      }
    }
    expect(errors).toEqual([])
  })
}
