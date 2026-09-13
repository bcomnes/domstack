import { expect, test } from './support.js'

test('page worker bundles support dedicated and shared workers', async ({ page, context, siteURL }) => {
  await page.goto(`${siteURL}/worker-page/`, { waitUntil: 'domcontentloaded' })

  await expect(page.locator('body')).not.toHaveAttribute('data-worker-error')
  await page.getByRole('button', { name: 'Increment', exact: true }).click()
  await expect(page.locator('#counter')).toHaveText('1')

  const sharedCounter = page.locator('#shared-counter')
  await expect(sharedCounter).toHaveText('0')
  await page.getByRole('button', { name: 'Increment shared counter' }).click()
  await expect(sharedCounter).toHaveText('1')

  const secondPage = await context.newPage()
  await secondPage.goto(`${siteURL}/worker-page/`, { waitUntil: 'domcontentloaded' })
  await expect(secondPage.locator('body')).not.toHaveAttribute('data-worker-error')
  await expect(secondPage.locator('#shared-counter')).toHaveText('1')

  await secondPage.getByRole('button', { name: 'Increment shared counter' }).click()
  await expect(secondPage.locator('#shared-counter')).toHaveText('2')
  await expect(sharedCounter).toHaveText('2')
})
