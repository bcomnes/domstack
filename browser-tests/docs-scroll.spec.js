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

test('the breadcrumb spans only the docs column and keeps its text aligned while sticky', async ({ page, siteURL }) => {
  await page.goto(`${siteURL}/docs/pages/`)
  for (const width of [390, 1100, 1500, 2000]) {
    await page.setViewportSize({ width, height: 900 })
    for (const top of [0, 900]) {
      await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), top)
      const geometry = await page.evaluate(() => {
        const shell = document.querySelector('.docs-shell').getBoundingClientRect()
        const content = document.querySelector('.docs-content')
        const style = getComputedStyle(content)
        const bounds = content.getBoundingClientRect()
        const breadcrumb = document.querySelector('.docs-breadcrumb').getBoundingClientRect()
        const text = document.querySelector('.docs-breadcrumb ol').getBoundingClientRect()
        return {
          left: breadcrumb.left,
          expectedLeft: bounds.left + parseFloat(style.borderLeftWidth),
          right: breadcrumb.right,
          expectedRight: shell.right,
          textLeft: text.left,
          expectedTextLeft: bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
          top: breadcrumb.top,
          stickyTop: parseFloat(getComputedStyle(document.querySelector('.docs-breadcrumb')).top),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })
      expect(Math.abs(geometry.left - geometry.expectedLeft)).toBeLessThan(1)
      expect(Math.abs(geometry.right - geometry.expectedRight)).toBeLessThan(1)
      expect(Math.abs(geometry.textLeft - geometry.expectedTextLeft)).toBeLessThan(1)
      expect(geometry.overflow).toBe(false)
      if (top) expect(Math.abs(geometry.top - geometry.stickyTop)).toBeLessThan(1)
    }
  }
})

test('reading position updates the URL, sidebar, and breadcrumb without navigating', async ({ page, siteURL }) => {
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
  const breadcrumb = page.locator('.docs-breadcrumb-section a')
  await expect(section).toHaveText('Page Styles')
  await expect(breadcrumb).toHaveText('Page Styles')
  await expect(breadcrumb).toHaveAttribute('href', '#page-styles')
  await expect(breadcrumb).toHaveAttribute('aria-current', 'location')
  await expect(page.locator('.docs-breadcrumb [aria-current]')).toHaveCount(1)
  const itemStyles = await page.locator('.docs-breadcrumb li > a').evaluateAll(links => links.map(link => {
    const style = getComputedStyle(link)
    const bounds = link.getBoundingClientRect()
    return {
      color: style.color,
      font: style.font,
      decoration: style.textDecorationLine,
      top: bounds.top,
      inset: bounds.left - link.parentElement.getBoundingClientRect().left,
    }
  }))
  const original = itemStyles[1]
  const added = itemStyles.at(-1)
  expect(added.color).toBe(original.color)
  expect(added.font).toBe(original.font)
  expect(added.decoration).toBe(original.decoration)
  expect(added.top).toBeCloseTo(original.top, 1)
  expect(added.inset).toBeCloseTo(original.inset, 1)

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
  await expect(breadcrumb).toHaveText('Page client bundles')
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
  await expect(breadcrumb).toHaveText('.tsx')
  await expect(breadcrumb).toHaveAttribute('href', `#${encodeURIComponent(id)}`)

  // Scrolling upwards selects the preceding section, then clears the fragment.
  await scrollToHeading(page.locator('#page-styles'))
  await expect(page).toHaveURL(`${base}#page-styles`)
  await expect(section).toHaveText('Page Styles')
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await expect(page).toHaveURL(base)
  await expect(section).toHaveCount(0)
  await expect(breadcrumb).toHaveCount(0)
  await expect(page.locator('.docs-breadcrumb [aria-current="page"]')).toHaveText('pages')
  expect(await page.evaluate(() => history.length)).toBe(length)
})

test('long breadcrumb headings are safe text and truncate on mobile without growing the bar', async ({ page, siteURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${siteURL}/docs/pages/`)
  const bar = page.locator('.docs-breadcrumb')
  const initialHeight = (await bar.boundingBox()).height
  const title = '<em>A long section heading with markup, detailed explanations, and many additional words</em>'
  await page.locator('#page-styles').evaluate((heading, title) => {
    heading.textContent = title
    location.hash = heading.id
  }, title)
  const breadcrumb = page.locator('.docs-breadcrumb-section a')
  await expect(breadcrumb).toHaveText(title)
  await expect(breadcrumb).toHaveAttribute('title', title)
  await expect(breadcrumb.locator('em')).toHaveCount(0)
  expect(await breadcrumb.evaluate(link => link.scrollWidth > link.clientWidth)).toBe(true)
  expect((await bar.boundingBox()).height).toBeCloseTo(initialHeight, 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
})

test('explicit anchors and Back/Forward win over pending reading-position updates', async ({ page, siteURL }) => {
  test.setTimeout(30_000)
  await page.goto(`${siteURL}/docs/layouts/#declaring-nested-layouts`)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await waitForScrollToSettle(page)
  const first = page.url()
  const breadcrumb = page.locator('.docs-breadcrumb-section a')
  await expect(breadcrumb).toHaveText('Declaring nested layouts')
  // Schedule a reading-position update, then navigate before its timer fires.
  await page.locator('#layout-variables').evaluate(async heading => {
    heading.scrollIntoView({ behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
  // A link near the bottom cannot necessarily align its heading with the top.
  await page.locator('.docs-navigation a[href="./#custom-layout-renderers"]').click()
  const second = `${siteURL}/docs/layouts/#custom-layout-renderers`
  await expect(page).toHaveURL(second)
  await expect(breadcrumb).toHaveText('Custom layout renderers')
  await waitForScrollToSettle(page)
  await page.waitForTimeout(450)
  await expect(page).toHaveURL(second)
  await page.goBack()
  await expect(page).toHaveURL(first)
  await expect(breadcrumb).toHaveText('Declaring nested layouts')
  await waitForScrollToSettle(page)
  await page.waitForTimeout(450)
  await expect(page).toHaveURL(first)
  await page.goForward()
  await expect(page).toHaveURL(second)
  await expect(breadcrumb).toHaveText('Custom layout renderers')
  await waitForScrollToSettle(page)
  await page.waitForTimeout(450)
  await expect(page).toHaveURL(second)
})
