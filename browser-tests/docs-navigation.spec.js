import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: websiteOptions,
})

test('an index section link navigates and selects the matching sidebar entry', async ({ page, siteURL }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto(`${siteURL}/docs/`)
  await page.locator('.docs-index a[href="layouts/#declaring-nested-layouts"]').click()
  await expect(page).toHaveURL(`${siteURL}/docs/layouts/#declaring-nested-layouts`)
  const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(nav.locator('a[aria-current="page"]')).toHaveText('Layouts')
  await expect(nav.locator('a[aria-current="location"]')).toHaveText('Declaring nested layouts')
})

test('mobile navigation manages focus, section links, and return to desktop', async ({ page, siteURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${siteURL}/docs/layouts/`)
  const toggle = page.getByRole('button', { name: 'Open documentation menu' })
  const menu = page.getByRole('dialog', { name: 'Documentation', exact: true })
  const close = menu.getByRole('button', { name: 'Close documentation menu' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(close).toBeFocused()
  // Opening the modal must prevent focus from escaping into the page.
  await toggle.evaluate(el => el.focus())
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await toggle.click()
  await menu.getByRole('link', { name: 'Layout module exports', exact: true }).click()
  await expect(menu).toBeHidden()
  await expect(page).toHaveURL(`${siteURL}/docs/layouts/#layout-module-exports`)
  await expect(page.locator('#layout-module-exports')).toBeFocused()
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).overflow)).not.toBe('hidden')

  // Resizing an open menu must restore navigation without leaving a modal or
  // scroll lock behind. The restored links must still work.
  await toggle.click()
  await page.setViewportSize({ width: 1500, height: 900 })
  await expect(menu).toBeHidden()
  await expect(toggle).toBeHidden()
  const nav = page.getByRole('navigation', { name: 'Documentation', exact: true })
  await expect(nav).toBeVisible()
  await expect(nav).toHaveCount(1)
  expect(await page.locator('html').evaluate(el => getComputedStyle(el).overflow)).not.toBe('hidden')
  await nav.getByRole('link', { name: 'CLI', exact: true }).click()
  await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the server-rendered index and mobile navigation remain usable', async ({ page, siteURL }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${siteURL}/docs/`)
    await page.locator('.docs-index a[href="layouts/#declaring-nested-layouts"]').click()
    await expect(page).toHaveURL(`${siteURL}/docs/layouts/#declaring-nested-layouts`)
    await expect(page.getByRole('button', { name: 'Open documentation menu' })).toBeHidden()
    const nav = page.locator('.docs-navigation')
    await expect(nav).toBeVisible()
    await nav.getByRole('link', { name: 'CLI', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`${siteURL}/docs/cli/`)
  })
})
