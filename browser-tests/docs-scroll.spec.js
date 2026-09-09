import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: websiteOptions,
})

// Wait for native smooth scrolling as well as browsers that restore instantly.
async function waitForScrollToSettle (page) {
  await page.evaluate(() => new Promise(resolve => {
    let timer
    const finish = () => {
      removeEventListener('scroll', reset)
      resolve()
    }
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(finish, 200)
    }
    addEventListener('scroll', reset, { passive: true })
    reset()
  }))
}

test('reading position updates the URL and sidebar without navigating', async ({ page, siteURL }) => {
  test.setTimeout(30_000)
  await page.setViewportSize({ width: 1500, height: 900 })
  const base = `${siteURL}/docs/pages/?reading=test`
  await page.goto(`${base}#page-styles`)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await waitForScrollToSettle(page)
  await page.evaluate(() => {
    history.replaceState({ preserved: true }, '', location.href)
    document.getElementById('docs-content').focus({ preventScroll: true })
  })
  const length = await page.evaluate(() => history.length)
  const section = page.locator('.docs-navigation a[aria-current="location"]')
  await expect(section).toHaveText('Page Styles')

  const scrollToHeading = async locator => {
    return locator.evaluate(heading => {
      const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)
      scrollTo({ top: scrollY + heading.getBoundingClientRect().top - offset + 2, behavior: 'instant' })
      return scrollY
    })
  }
  const y = await scrollToHeading(page.locator('#page-client-bundles'))
  await expect(page).toHaveURL(`${base}#page-client-bundles`)
  await expect(section).toHaveText('Page client bundles')
  expect(await page.evaluate(() => ({
    y: scrollY, length: history.length, state: history.state, focus: document.activeElement.id,
  }))).toEqual({ y, length, state: { preserved: true }, focus: 'docs-content' })

  // A real wheel scroll across the boundary also selects the preceding section.
  await page.mouse.move(1400, 400)
  await page.mouse.wheel(0, -100)
  await expect(page).toHaveURL(`${base}#page-styles`)
  await expect(section).toHaveText('Page Styles')

  // h4 has a URL of its own but keeps the parent h3 selected in the shared ToC.
  const deeper = page.locator('#docs-content h4').filter({ hasText: '.tsx' })
  const id = await deeper.getAttribute('id')
  await scrollToHeading(deeper)
  await expect(page).toHaveURL(`${base}#${encodeURIComponent(id)}`)
  await expect(section).toHaveText('Page client bundles')

  // Scrolling upwards selects the preceding section, then clears the fragment.
  await scrollToHeading(page.locator('#page-styles'))
  await expect(page).toHaveURL(`${base}#page-styles`)
  await expect(section).toHaveText('Page Styles')
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await expect(page).toHaveURL(base)
  await expect(section).toHaveCount(0)
  expect(await page.evaluate(() => history.length)).toBe(length)
})

test('explicit anchors and Back/Forward win over pending reading-position updates', async ({ page, siteURL }) => {
  test.setTimeout(30_000)
  await page.goto(`${siteURL}/docs/layouts/#declaring-nested-layouts`)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await waitForScrollToSettle(page)
  const first = page.url()
  // Schedule a reading-position update, then navigate before its timer fires.
  await page.locator('#layout-variables').evaluate(async heading => {
    heading.scrollIntoView({ behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
  // A link near the bottom cannot necessarily align its heading with the top.
  await page.locator('.docs-navigation a[href="./#custom-layout-renderers"]').click()
  const second = `${siteURL}/docs/layouts/#custom-layout-renderers`
  await expect(page).toHaveURL(second)
  await waitForScrollToSettle(page)
  await page.waitForTimeout(450)
  await expect(page).toHaveURL(second)
  await page.goBack()
  await expect(page).toHaveURL(first)
  await waitForScrollToSettle(page)
  await page.waitForTimeout(450)
  await expect(page).toHaveURL(first)
  await page.goForward()
  await expect(page).toHaveURL(second)
  await waitForScrollToSettle(page)
  await page.waitForTimeout(450)
  await expect(page).toHaveURL(second)
})
