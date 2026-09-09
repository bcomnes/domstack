import { resolve } from 'node:path'
import { expect, test, websiteOptions } from './support.js'

test.use({
  siteSrc: resolve(import.meta.dirname, '..'),
  siteOptions: websiteOptions,
})

for (const colorScheme of ['light', 'dark']) {
  test(`renders documentation diagrams and direct section links in ${colorScheme} mode`, async ({ page, siteURL }) => {
    test.setTimeout(30_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.emulateMedia({ colorScheme })
    await page.goto(`${siteURL}/docs/implementation/`)

    async function expectDiagrams () {
      const diagrams = page.locator('.mermaid')
      await expect(diagrams).toHaveCount(3)
      for (const diagram of await diagrams.all()) {
        // Mermaid can render an error SVG without throwing a page error.
        await expect(diagram.locator('svg')).toBeVisible()
        await expect(diagram.locator('svg .flowchart-link').first()).toBeAttached()
        await expect(diagram.locator('.error-icon')).toHaveCount(0)
        await expect(diagram).toHaveAttribute('tabindex', '0')
        await expect(diagram).toHaveAttribute('aria-label', /diagram$/)
        await expect(diagram.locator('svg title')).toHaveCount(1)
        await expect(diagram.locator('svg desc')).toHaveCount(1)
        const colors = await diagram.evaluate(element => ({
          text: getComputedStyle(element).color,
          labels: [...element.querySelectorAll('text')].map(label => getComputedStyle(label).fill),
          edges: [...element.querySelectorAll('.flowchart-link')].map(path => getComputedStyle(path).stroke),
          arrows: [...element.querySelectorAll('marker path')].map(path => getComputedStyle(path).fill),
        }))
        expect(colors.arrows.length).toBeGreaterThan(0)
        expect(colors.edges.every(color => color === colors.text)).toBe(true)
        expect(colors.arrows.every(color => color === colors.text)).toBe(true)
        expect(colors.labels.every(color => color === colors.text)).toBe(true)
      }
    }

    await expectDiagrams()
    // Parallel lanes are the point of these diagrams, not incidental decoration.
    const parallelRows = [
      ['ESBUILD', 'STATIC', 'COPY'],
      ['PAGE_RENDER', 'TEMPLATE_RENDER'],
    ]
    for (const row of parallelRows) {
      const boxes = await Promise.all(row.map(id => page.locator(`.node[id*="-flowchart-${id}-"]`).boundingBox()))
      const centers = boxes.map(box => box.y + box.height / 2)
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1)
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i - 1].x + boxes[i - 1].width).toBeLessThan(boxes[i].x)
      }
    }
    const pageDiagram = page.getByRole('region', { name: 'Page building diagram' })
    const laneBoxes = await Promise.all(['Markdown page task', 'HTML page task', 'JS / TS page task']
      .map(label => pageDiagram.locator('.cluster').filter({ hasText: label }).boundingBox()))
    const laneCenters = laneBoxes.map(box => box.y + box.height / 2)
    expect(Math.max(...laneCenters) - Math.min(...laneCenters)).toBeLessThan(1)
    for (let i = 1; i < laneBoxes.length; i++) {
      expect(laneBoxes[i - 1].x + laneBoxes[i - 1].width).toBeLessThan(laneBoxes[i].x)
    }
    for (const type of ['MD', 'HTML', 'JS']) {
      const vars = await pageDiagram.locator(`.node[id*="-flowchart-${type}_VARS-"]`).boundingBox()
      const read = await pageDiagram.locator(`.node[id*="-flowchart-${type}_READ-"]`).boundingBox()
      expect(vars.y + vars.height).toBeLessThan(read.y)
      expect(vars.x + vars.width / 2).toBeCloseTo(read.x + read.width / 2, 0)
    }
    for (const label of [
      'Parallel rendering',
      'JS / TS page task', 'HTML page task', 'Markdown page task',
    ]) {
      await expect(pageDiagram.locator('.cluster-label').filter({ hasText: label })).toHaveCount(1)
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const diagrams = await page.locator('.mermaid').all()
      for (const [index, diagram] of diagrams.entries()) {
        const size = await diagram.evaluate(el => {
          const svg = el.querySelector('svg')
          return {
            rendered: svg.getBoundingClientRect().width,
            intrinsic: svg.viewBox.baseVal.width,
            viewport: el.clientWidth,
            content: el.scrollWidth,
          }
        })
        // Do not silently shrink text to squeeze three lanes onto a phone.
        expect(size.rendered).toBeCloseTo(size.intrinsic, 0)
        if (width === 1440 && index < 2) expect(size.content).toBe(size.viewport)
        if (width === 390) {
          expect(size.content).toBeGreaterThan(size.viewport)
          await diagram.focus()
          await expect(diagram).toBeFocused()
          await page.keyboard.press('ArrowRight')
          await expect.poll(() => diagram.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
        }
      }
    }
    await page.goto(`${siteURL}/docs/implementation/#build-process-flow`)
    await expect(page).toHaveURL(`${siteURL}/docs/implementation/#build-process-flow`)
    await expectDiagrams()
    expect(errors).toEqual([])
  })
}
