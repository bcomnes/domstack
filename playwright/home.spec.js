import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: websiteOptions,
})

test('the homepage keeps referral links and navigates to the documentation', async ({ page, siteURL }) => {
  const referral = `${siteURL}/?ref=blog.thenotification.app`
  expect((await page.goto(referral))?.status()).toBe(200)
  await expect(page).toHaveURL(referral)
  await expect(page.getByRole('heading', { level: 1, name: 'domstack' })).toBeVisible()
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', 'https://domstack.net/')

  await page.getByRole('banner').getByRole('link', { name: 'Docs', exact: true }).click()
  await expect(page).toHaveURL(`${siteURL}/docs/`)
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', 'https://domstack.net/docs/')
})
