import { expect, test } from './support.js'

async function cascadeValue (page) {
  return page.getByTestId('cascade-layer-fixture').evaluate(element => {
    return getComputedStyle(element).getPropertyValue('--domstack-cascade-layer').trim()
  })
}

test('orders mine, global, layout, and page cascade layers', async ({ page, siteURL }) => {
  await page.goto(`${siteURL}/`, { waitUntil: 'domcontentloaded' })
  await page.addStyleTag({
    content: '@layer mine { .cascade-layer-fixture { --domstack-cascade-layer: mine; } }'
  })

  await expect(page.getByTestId('cascade-layer-fixture')).toHaveCount(1)
  await expect.poll(() => cascadeValue(page)).toBe('page')

  await page.locator('link[rel="stylesheet"][href*="style-"]').evaluate(element => element.remove())
  await expect.poll(() => cascadeValue(page)).toBe('layout')

  await page.locator('link[rel="stylesheet"][href*="root.layout-"]').evaluate(element => element.remove())
  await expect.poll(() => cascadeValue(page)).toBe('global')

  await page.locator('link[rel="stylesheet"][href*="global-"]').evaluate(element => element.remove())
  await expect.poll(() => cascadeValue(page)).toBe('mine')
})
