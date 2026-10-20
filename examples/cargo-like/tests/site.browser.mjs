import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const exampleRoot = fileURLToPath(new URL('../', import.meta.url))
const root = resolve(exampleRoot, 'public')
const artifacts = resolve(exampleRoot, 'artifacts')
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' }
let server, browser, origin
const failures = []

before(async () => {
  await mkdir(artifacts, { recursive: true })
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const file = resolve(root, `.${pathname}${pathname.endsWith('/') ? 'index.html' : ''}`)
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return }
      const content = await readFile(file)
      const headers = { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' }
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range)
        const start = match ? Number(match[1]) : -1
        const end = match?.[2] ? Math.min(Number(match[2]), content.length - 1) : content.length - 1
        if (start < 0 || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${content.length}` }).end(); return }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Content-Length': end - start + 1 }).end(content.subarray(start, end + 1))
      } else res.writeHead(200, { ...headers, 'Content-Length': content.length }).end(content)
    } catch { res.writeHead(404).end('Not found') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch()
})

after(async () => {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
})

async function openPage (options = {}, path = '/', prepare) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options })
  page.on('pageerror', error => failures.push(error.message))
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`) })
  page.on('requestfailed', request => failures.push(`Failed ${request.url()}`))
  page.on('request', request => {
    if (!request.url().startsWith(origin)) failures.push(`Unexpected external request: ${request.url()}`)
  })
  await prepare?.(page)
  await page.goto(origin + path, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  return page
}

async function scrollThrough (page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  const step = page.viewportSize().height * 0.7
  for (let top = 0; top < height; top += step) {
    await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), top)
    await page.waitForTimeout(60)
  }
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter(image => image.getAttribute('src')).map(image => image.decode()))
  })
}

test('desktop: sections, local assets, navigation, lightbox and keyboard dragging', async () => {
  const page = await openPage({ reducedMotion: 'reduce' })
  try {
    assert.equal(await page.title(), 'A study in ordinary things — Cargo / Like')
    const credit = page.locator('.site-footer .powered-by')
    assert.equal(await credit.textContent(), 'Powered by domstack')
    const wordmark = credit.getByRole('link', { name: 'domstack', exact: true })
    assert.equal(await wordmark.getAttribute('href'), 'https://domstack.net')
    assert.match(await wordmark.evaluate(el => getComputedStyle(el).fontFamily), /DSWeiss-Gotisch/)
    assert.equal(await wordmark.evaluate(el => getComputedStyle(el).textTransform), 'none')
    assert.equal(await page.locator('section.slide').count(), 8)
    assert.equal(await page.locator('h1').count(), 1)
    assert.equal(await page.locator('.chapter-nav a').count(), 8)
    assert.equal(await page.locator('a[href^="/slides/"][href$="/"]').count(), 0)
    assert.equal(await page.locator('.slide-permalink').count(), 0)
    assert.ok(await page.evaluate(() => ['Inter', 'Fraunces'].every(family =>
      [...document.fonts].some(face => face.family === family && face.status === 'loaded')
    )))
    const sticker = page.locator('[data-drag]')
    await sticker.focus()
    const start = await sticker.evaluate(el => el.style.getPropertyValue('--drag-x'))
    await page.keyboard.press('ArrowLeft')
    assert.notEqual(await sticker.evaluate(el => el.style.getPropertyValue('--drag-x')), start)
    await page.keyboard.press('Home')
    assert.equal(await sticker.evaluate(el => el.style.getPropertyValue('--drag-x')), '0px')
    await page.locator('.chapter-nav a[href="/#collection"]').click()
    await page.waitForFunction(() => location.hash === '#collection' && document.querySelector('.chapter-nav a[href="/#collection"]').hasAttribute('aria-current'))
    assert.ok(Math.abs((await page.locator('#collection').boundingBox()).y) < 1, 'Slide anchors must align with the viewport top')
    const card = page.locator('.photo-grid a.photo-card[data-lightbox]').first()
    const viewer = page.locator('.pswp')
    await card.click()
    await viewer.waitFor({ state: 'visible' })
    assert.equal(await viewer.getAttribute('role'), 'dialog')
    await viewer.locator('.pswp__item').nth(1).locator('img.pswp__img:not(.pswp__img--placeholder)').waitFor({ state: 'visible' })
    assert.equal(await viewer.locator('.pswp__item').nth(1).locator('img.pswp__img:not(.pswp__img--placeholder)').getAttribute('alt'), await card.locator('img').getAttribute('alt'))
    await viewer.getByText(await card.getAttribute('data-caption'), { exact: true }).waitFor({ state: 'visible' })
    await page.waitForTimeout(600)
    await page.screenshot({ path: resolve(artifacts, 'desktop-gallery.png') })
    await page.keyboard.press('Escape')
    await viewer.waitFor({ state: 'detached' })
    assert.equal(await card.evaluate(el => el === document.activeElement), true)
    await card.click()
    await viewer.waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Close photograph viewer', exact: true }).click()
    await viewer.waitFor({ state: 'detached' })
    assert.equal(await card.evaluate(el => el === document.activeElement), true)
    await scrollThrough(page)
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0) })
    await page.screenshot({ path: resolve(artifacts, 'desktop.png'), fullPage: true })
    await page.screenshot({ path: resolve(artifacts, 'desktop-top.png') })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  } finally { await page.close() }
})

test('mobile: menu, deep links, gallery, overflow and screenshot', async () => {
  const page = await openPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  try {
    const menu = page.getByRole('button', { name: 'Chapters' })
    assert.equal(await menu.isVisible(), true)
    assert.equal(await page.locator('.chapter-nav').isVisible(), false)
    await menu.click()
    assert.equal(await menu.getAttribute('aria-expanded'), 'true')
    const headerBox = await page.locator('.site-header').boundingBox()
    const menuBox = await page.locator('.chapter-nav').boundingBox()
    assert.ok(menuBox.y >= headerBox.y + headerBox.height - 1)
    assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390)
    await page.keyboard.press('Escape')
    assert.equal(await menu.getAttribute('aria-expanded'), 'false')
    await menu.click()
    await page.locator('.chapter-nav a[href="/#study"]').click()
    await page.waitForFunction(() => location.hash === '#study')
    assert.equal(await menu.getAttribute('aria-expanded'), 'false')
    const card = page.locator('.photo-grid a.photo-card[data-lightbox]').first()
    await card.click()
    await page.locator('.pswp').waitFor({ state: 'visible' })
    await page.locator('.pswp').getByText(await card.getAttribute('data-caption'), { exact: true }).waitFor({ state: 'visible' })
    await page.waitForTimeout(600)
    await page.screenshot({ path: resolve(artifacts, 'mobile-gallery.png') })
    await page.getByRole('button', { name: 'Close photograph viewer', exact: true }).click()
    await page.locator('.pswp').waitFor({ state: 'detached' })
    assert.equal(await card.evaluate(el => el === document.activeElement), true)
    await scrollThrough(page)
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}px`)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0) })
    await page.screenshot({ path: resolve(artifacts, 'mobile.png'), fullPage: true })
    await page.screenshot({ path: resolve(artifacts, 'mobile-top.png') })
  } finally { await page.close() }
})

test('gallery: natural dimensions, arrow controls, keyboard navigation, zoom and reduced motion', async () => {
  const page = await openPage({ reducedMotion: 'reduce', viewport: { width: 800, height: 600 } })
  try {
    const cards = page.locator('.photo-grid').first().locator('a.photo-card[data-lightbox]')
    assert.ok(await cards.count() >= 2)
    for (const card of await cards.all()) {
      assert.equal(await card.getAttribute('data-pswp-cropped'), 'true')
      assert.equal(await card.locator('img').evaluate(el => getComputedStyle(el).objectFit), 'cover')
      const dimensions = await card.evaluate(async el => {
        const image = new Image()
        image.src = el.href
        await image.decode()
        return { width: Number(el.dataset.pswpWidth), height: Number(el.dataset.pswpHeight), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight }
      })
      assert.ok(dimensions.width > 0 && dimensions.height > 0)
      assert.equal(dimensions.width, dimensions.naturalWidth)
      assert.equal(dimensions.height, dimensions.naturalHeight)
    }
    const viewer = page.locator('.pswp')
    const firstCaption = await cards.nth(0).getAttribute('data-caption')
    const secondCaption = await cards.nth(1).getAttribute('data-caption')
    await cards.first().click()
    await viewer.waitFor({ state: 'visible' })
    await viewer.getByText(firstCaption, { exact: true }).waitFor({ state: 'visible' })
    await viewer.getByRole('button', { name: 'Next photograph', exact: true }).click()
    await viewer.getByText(secondCaption, { exact: true }).waitFor({ state: 'visible' })
    await viewer.getByRole('button', { name: 'Previous photograph', exact: true }).click()
    await viewer.getByText(firstCaption, { exact: true }).waitFor({ state: 'visible' })
    await page.keyboard.press('ArrowRight')
    await viewer.getByText(secondCaption, { exact: true }).waitFor({ state: 'visible' })
    await page.keyboard.press('ArrowLeft')
    await viewer.getByText(firstCaption, { exact: true }).waitFor({ state: 'visible' })
    const zoom = viewer.getByRole('button', { name: 'Zoom photograph', exact: true })
    await zoom.click()
    await page.locator('.pswp.pswp--zoomed-in').waitFor({ state: 'visible' })
    assert.equal(await viewer.locator('.pswp__item').nth(1).locator('.pswp__zoom-wrap').evaluate(el =>
      getComputedStyle(el).transitionDuration.split(',').every(duration => parseFloat(duration) === 0)), true)
    await zoom.click()
    await page.waitForFunction(() => !document.querySelector('.pswp').classList.contains('pswp--zoomed-in'))
    await page.keyboard.press('Escape')
    await viewer.waitFor({ state: 'detached' })
    assert.equal(await cards.first().evaluate(el => el === document.activeElement), true)
  } finally { await page.close() }
})

test('gallery: arrow keys animate between slides when motion is allowed', async () => {
  const page = await openPage({ reducedMotion: 'no-preference' }, '/slides/collection/')
  try {
    const cards = page.locator('.photo-grid a[data-lightbox]')
    await cards.first().click()
    const viewer = page.locator('.pswp')
    await viewer.waitFor({ state: 'visible' })
    await page.waitForTimeout(500)
    for (const [key, index] of [['ArrowRight', 1], ['ArrowLeft', 0]]) {
      const transforms = await viewer.evaluate(async (el, key) => {
        const container = el.querySelector('.pswp__container')
        const samples = [container.style.transform]
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        for (let frame = 0; frame < 12; frame++) {
          await new Promise(resolve => requestAnimationFrame(resolve))
          samples.push(container.style.transform)
        }
        return samples
      }, key)
      assert.ok(new Set(transforms).size > 2, `${key} should animate through intermediate positions`)
      await viewer.getByText(await cards.nth(index).getAttribute('data-caption'), { exact: true }).waitFor({ state: 'visible' })
      await page.waitForTimeout(500)
    }
    await page.keyboard.press('Escape')
    await viewer.waitFor({ state: 'detached' })
  } finally { await page.close() }
})

test('gallery: captions and alt fallbacks are inert text, never HTML', async () => {
  const text = '01 / <img src="/caption-must-not-load.jpg" onerror="window.captionExecuted = true"> & <b>Lorem</b>'
  for (const source of ['caption', 'alt']) {
    const page = await openPage({ reducedMotion: 'reduce' })
    try {
      const card = page.locator('.photo-grid a.photo-card[data-lightbox]').first()
      await card.evaluate((el, { source, text }) => {
        if (source === 'caption') el.dataset.caption = text
        else {
          el.removeAttribute('data-caption')
          el.querySelector('img').alt = text
        }
      }, { source, text })
      await card.click()
      const viewer = page.locator('.pswp')
      await viewer.waitFor({ state: 'visible' })
      const caption = viewer.locator('.pswp__dynamic-caption').filter({ hasText: text })
      await caption.waitFor({ state: 'visible' })
      assert.equal(await caption.textContent(), text)
      assert.equal(await caption.locator('img, b, [onerror]').count(), 0)
      assert.equal(await page.evaluate(() => window.captionExecuted), undefined)
      await page.keyboard.press('Escape')
      await viewer.waitFor({ state: 'detached' })
    } finally { await page.close() }
  }
})

test('gallery: standalone collection opens, navigates and restores focus', async () => {
  const page = await openPage({ reducedMotion: 'reduce' }, '/slides/collection/')
  try {
    const cards = page.locator('.photo-grid a.photo-card[data-lightbox]')
    await cards.first().click()
    const viewer = page.locator('.pswp')
    await viewer.waitFor({ state: 'visible' })
    assert.equal(await viewer.getAttribute('role'), 'dialog')
    await viewer.getByRole('button', { name: 'Next photograph', exact: true }).click()
    await viewer.getByText(await cards.nth(1).getAttribute('data-caption'), { exact: true }).waitFor({ state: 'visible' })
    await viewer.getByRole('button', { name: 'Close photograph viewer', exact: true }).click()
    await viewer.waitFor({ state: 'detached' })
    assert.equal(await cards.first().evaluate(el => el === document.activeElement), true)
  } finally { await page.close() }
})

test('gallery: no-JavaScript cards remain direct image links on both views', async () => {
  for (const path of ['/', '/slides/collection/']) {
    const page = await openPage({ javaScriptEnabled: false }, path)
    try {
      const cards = page.locator('.photo-grid a.photo-card[data-lightbox]')
      assert.ok(await cards.count() >= 2)
      for (const card of await cards.all()) {
        assert.ok((await card.getAttribute('href')).startsWith('/slides/') && (await card.getAttribute('href')).endsWith('.jpg'))
        assert.ok(await card.locator('img').getAttribute('alt'))
      }
      const href = await cards.first().getAttribute('href')
      await cards.first().click()
      await page.waitForURL(origin + href)
      assert.equal(await page.locator('.pswp').count(), 0)
    } finally { await page.close() }
  }
})

test('standalone chapters have one slide, a heading and working return links', async () => {
  for (const id of ['opening', 'motion', 'interval', 'study', 'composition', 'collection', 'contact', 'colophon']) {
    const page = await openPage({ reducedMotion: 'reduce' }, `/slides/${id}/`)
    try {
      assert.equal(await page.locator('section.slide').count(), 1)
      assert.equal(await page.locator('h1').count(), 1)
      assert.equal(await page.locator('body').getAttribute('data-view'), 'slide')
      const back = page.getByRole('link', { name: 'View in sequence' })
      assert.equal(await back.getAttribute('href'), `/#${id}`)
      await back.click()
      await page.waitForURL(`${origin}/#${id}`)
      assert.equal(await page.locator('section.slide').count(), 8)
    } finally { await page.close() }
  }
})

test('progressive enhancement: readable without JS and with reduced motion', async () => {
  const page = await openPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  try {
    assert.equal(await page.locator('.chapter-nav').isVisible(), true)
    assert.equal(await page.locator('section.slide').count(), 8)
    for (const content of await page.locator('[data-reveal]').all()) {
      assert.equal(await content.evaluate(el => getComputedStyle(el).opacity), '1')
    }
    await page.locator('.chapter-nav a[href="/#interval"]').click()
    assert.ok(page.url().endsWith('#interval'))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  } finally { await page.close() }
  const reduced = await openPage({ reducedMotion: 'reduce' })
  try {
    assert.equal(await reduced.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto')
    assert.equal(await reduced.locator('.reveal-pending').count(), 0)
  } finally { await reduced.close() }
})

test('normal motion: reveals settle and pointer dragging is bounded', async () => {
  const page = await openPage()
  try {
    const sticker = page.locator('[data-drag]')
    await sticker.scrollIntoViewIfNeeded()
    const box = await sticker.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 100, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()
    assert.ok(Number.parseFloat(await sticker.evaluate(el => el.style.getPropertyValue('--drag-x'))) < 0)
    const inside = await sticker.evaluate(el => {
      const a = el.getBoundingClientRect(); const b = el.parentElement.getBoundingClientRect()
      return a.left >= b.left - 1 && a.right <= b.right + 1
    })
    assert.equal(inside, true)
    const ornament = page.locator('[data-pointer-rotate]').first()
    await page.mouse.move(100, 100)
    await page.waitForFunction(() => document.querySelector('[data-pointer-rotate]').style.getPropertyValue('--pointer-rotate') !== '')
    assert.ok(await ornament.evaluate(el => el.style.getPropertyValue('--pointer-rotate').endsWith('deg')))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => document.querySelector('[data-pointer-rotate]').style.getPropertyValue('--pointer-rotate') === '')
    await scrollThrough(page)
    await page.waitForTimeout(700)
    assert.equal(await page.locator('.reveal-pending').count(), 0)
  } finally { await page.close() }
})

test('homepage and standalone stylesheets supply slide compositions outside the shared global CSS', async () => {
  const globalCSS = await readFile(resolve(exampleRoot, 'src/globals/global.css'), 'utf8')
  assert.doesNotMatch(globalCSS, /\.(?:type-|contact-)[\w-]+|\.slide\b|\.site-header\b|\.field-gallery\b|\.video-controls\b/)
  const pageCSS = await readFile(resolve(exampleRoot, 'src/page.css'), 'utf8')
  assert.match(pageCSS, /\.slide-backdrop\b/)
  assert.match(pageCSS, /@import 'photoswipe\/style\.css'/)
  assert.match(await readFile(resolve(exampleRoot, 'src/style.css'), 'utf8'), /@import '\.\/page\.css'/)
  for (const id of ['opening', 'motion', 'interval', 'study', 'composition', 'collection', 'contact', 'colophon']) {
    const slideCSS = await readFile(resolve(exampleRoot, `src/slides/${id}/style.css`), 'utf8')
    assert.match(slideCSS, /@import '\.\.\/\.\.\/page\.css'/)
    assert.doesNotMatch(slideCSS, /@import ['"]\.\/slide\.css['"]/)
    assert.ok((await readFile(resolve(exampleRoot, 'src/style.css'), 'utf8')).includes(`@import './slides/${id}/style.css';`))
  }
  const checks = [
    ['#opening .hero-title', 'display', 'flex'],
    ['#motion .motion-sequence', 'display', 'flex'],
    ['#interval .statement-title', 'fontFamily', /DSWeiss-Gotisch/],
    ['#study .editorial-passage', 'position', 'relative'],
    ['#composition .type-poster', 'position', 'relative'],
    ['#collection .photo-grid', 'display', 'grid'],
    ['#contact .contact-composition', 'display', 'grid'],
    ['#colophon .closing-composition', 'display', 'flex'],
  ]
  for (const id of [null, 'opening', 'motion', 'interval', 'study', 'composition', 'collection', 'contact', 'colophon']) {
    const path = id ? `/slides/${id}/` : '/'
    const page = await openPage({ reducedMotion: 'reduce' }, path)
    try {
      for (const [selector, property, expected] of checks) {
        if (id && !selector.startsWith(`#${id} `)) continue
        const actual = await page.locator(selector).first().evaluate((el, property) => getComputedStyle(el)[property], property)
        const message = `${path}: ${selector}`
        if (expected instanceof RegExp) assert.match(actual, expected, message)
        else assert.equal(actual, expected, message)
      }
    } finally { await page.close() }
  }
})

test('immersive layout: pinned backdrops, fitted type and top-right dock', async () => {
  const page = await openPage({ reducedMotion: 'reduce' })
  try {
    const backdrop = page.locator('#opening .slide-backdrop')
    for (const top of [400, 1000]) {
      await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), top)
      const box = await backdrop.boundingBox()
      assert.ok(Math.abs(box.y) < 1, `Backdrop should stay pinned at scroll ${top}: ${box.y}`)
      assert.equal(Math.round(box.width), 1440)
      assert.equal(Math.round(box.height), 1000)
    }
    await page.screenshot({ path: resolve(artifacts, 'desktop-middle.png') })
    for (const id of ['interval', 'study']) {
      await page.locator(`#${id}`).evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
      await page.waitForTimeout(150)
      await page.screenshot({ path: resolve(artifacts, `desktop-${id}.png`) })
    }
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.waitForTimeout(100)
      const fitted = await page.locator('[data-fit-text]').evaluateAll(lines => lines.every(el => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const textWidth = range.getBoundingClientRect().width
        return textWidth <= el.clientWidth && textWidth > el.clientWidth * 0.9
      }))
      assert.equal(fitted, true, `Text should fit its container at ${width}px`)
      const dock = await page.locator('.site-header').boundingBox()
      assert.ok(Math.abs(dock.y) < 1)
      assert.ok(Math.abs(dock.x + dock.width - width) < 1)
    }
  } finally { await page.close() }
})

test('Interval type study loads the local DOMStack font without clipping', async () => {
  for (const path of ['/', '/slides/interval/']) {
    const page = await openPage({ reducedMotion: 'reduce' }, path)
    try {
      const heading = page.locator('#interval .statement-title')
      assert.match(await heading.evaluate(el => getComputedStyle(el).fontFamily), /DSWeiss-Gotisch/)
      assert.ok(await page.evaluate(() => [...document.fonts].some(face =>
        face.family.replaceAll('"', '') === 'DSWeiss-Gotisch' && face.status === 'loaded'
      )))
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 })
        assert.ok(await heading.locator('span').evaluateAll(lines => lines.every(el => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return range.getBoundingClientRect().width <= el.clientWidth
        })), `Type study should fit at ${width}px`)
      }
      if (path === '/') {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.locator('#interval').evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
        await page.locator('#interval .backdrop-image img').evaluate(image => image.decode())
        await page.screenshot({ path: resolve(artifacts, 'mobile-interval.png') })
      }
    } finally { await page.close() }
  }
})

test('Composition: semantic titles, decorative glyphs, sticky backdrop and next link', async () => {
  for (const path of ['/', '/slides/composition/']) {
    const page = await openPage({ reducedMotion: 'reduce' }, path)
    try {
      const slide = page.locator('#composition')
      assert.equal(await slide.getAttribute('aria-label'), 'Lorem ipsum, in pieces')
      assert.ok(await slide.evaluate(el => el.classList.contains('slide--typography')))
      assert.equal((await slide.locator('.slide-number').textContent()).trim(), '05')
      assert.equal((await slide.locator('.slide-label').textContent()).trim(), 'Composition')
      assert.equal(await slide.getAttribute('data-background-mode'), 'sticky')
      assert.equal(await slide.locator('.slide-backdrop').evaluate(el => getComputedStyle(el).position), 'sticky')
      assert.equal(await slide.locator('.backdrop-image img').getAttribute('src'), '/slides/opening/architecture.jpg')
      assert.equal(await slide.locator('.type-poster').count(), 1)
      assert.equal(await slide.locator('.type-score').count(), 1)
      assert.ok(await slide.evaluate(el => Boolean(el.querySelector('.type-poster').compareDocumentPosition(el.querySelector('.type-score')) & Node.DOCUMENT_POSITION_FOLLOWING)))
      const title = slide.locator('.type-poster h2.type-title')
      assert.equal(await title.count(), 1)
      assert.equal(await slide.getByRole('heading', { level: 2, name: 'Lorem ipsum.', exact: true }).count(), 1)
      assert.equal((await title.locator('.sr-only').textContent()).trim(), 'Lorem ipsum.')
      assert.equal(await slide.locator('.type-score').getByRole('heading', { level: 3, name: 'Dolor sit amet.', exact: true }).count(), 1)
      for (const decoration of await title.locator('.type-letters, .type-serif').all()) {
        assert.ok(await decoration.evaluate(el => Boolean(el.closest('[aria-hidden="true"]'))))
      }
      const glyphs = title.locator('.type-letters span')
      assert.ok(await glyphs.count() > 1)
      assert.ok(await glyphs.evaluateAll(elements => elements.every(el => [...el.textContent.trim()].length === 1)))
      const rotations = await glyphs.evaluateAll(elements => elements.map(el => {
        const style = getComputedStyle(el)
        const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform)
        return `${Math.atan2(matrix.b, matrix.a).toFixed(3)}:${style.rotate}`
      }))
      assert.ok(new Set(rotations).size > 1, 'Individual glyphs should have varied CSS rotations')
      assert.equal(await title.locator('.type-serif').count(), 1)
      assert.ok(await slide.locator('.type-score .type-line').count() > 0)
      assert.ok(await slide.locator('.type-note').count() > 0)
      const orbit = slide.locator('svg.type-orbit')
      assert.equal(await orbit.count(), 1)
      assert.ok(await orbit.evaluate(el => Boolean(el.closest('[aria-hidden="true"]'))))
      assert.ok(await orbit.evaluate(el => el.hasAttribute('data-pointer-rotate') || Boolean(el.querySelector('[data-pointer-rotate]'))))
      assert.ok(await slide.locator('[data-reveal]').evaluateAll(elements => elements.every(el => Boolean(el.closest('.type-note')))))
      assert.equal(await slide.locator('.type-title[data-reveal], .type-title [data-reveal], .type-line[data-reveal], .type-line [data-reveal]').count(), 0)
      const next = slide.locator('a.type-next')
      assert.equal(await next.getAttribute('href'), '/#collection')
      await next.click()
      await page.waitForURL(`${origin}/#collection`)
    } finally { await page.close() }
  }
})

test('Composition: CSS-only readability, responsive text bounds and poster screenshots', async () => {
  for (const options of [{ javaScriptEnabled: false }, { reducedMotion: 'reduce' }]) {
    const page = await openPage(options, '/#composition')
    try {
      const slide = page.locator('#composition')
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
        for (const selector of ['.type-poster', '.type-score']) {
          await slide.locator(selector).evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Composition overflow at ${width}px (${JSON.stringify(options)})`)
          assert.ok(await slide.locator(`${selector} .type-letters, ${selector} .type-serif, ${selector} .type-line, ${selector} .type-note`).evaluateAll(elements => elements.length > 0 && elements.every(el => {
            for (let node = el; node; node = node.parentElement) {
              const style = getComputedStyle(node)
              if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
            }
            return el.getBoundingClientRect().height > 0
          })), `Composition must remain readable at ${width}px`)
          if (selector === '.type-score') {
            assert.ok(await slide.locator('.type-line').evaluateAll(lines => lines.every(el => {
              const range = document.createRange()
              range.selectNodeContents(el)
              return [...range.getClientRects()].every(box => box.left >= -1 && box.right <= innerWidth + 1)
            })), `Essential score text must stay within the viewport horizontally at ${width}px`)
          }
          if (options.reducedMotion && (width === 1440 || (width === 390 && selector === '.type-poster'))) {
            await slide.locator('.backdrop-image img').evaluate(image => image.decode())
            const name = width === 390 ? 'mobile-composition' : selector === '.type-score' ? 'desktop-composition-score' : 'desktop-composition'
            await page.screenshot({ path: resolve(artifacts, `${name}.png`) })
          }
        }
      }
      if (options.reducedMotion) {
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto')
        assert.equal(await slide.locator('.reveal-pending').count(), 0)
      }
      await slide.locator('a.type-next').click()
      await page.waitForURL(`${origin}/#collection`)
    } finally { await page.close() }
  }
})

test('background video: lazy, muted playback; pause, resume and offscreen suspension', async () => {
  const page = await openPage()
  try {
    const video = page.locator('#motion video')
    assert.equal(await video.getAttribute('src'), null)
    await page.locator('#motion').evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
    await page.waitForFunction(() => {
      const video = document.querySelector('#motion video')
      return !video.paused && video.currentTime > 0.2
    })
    assert.ok(await video.evaluate(el => el.muted && el.loop && el.playsInline && el.readyState >= 2))
    await page.screenshot({ path: resolve(artifacts, 'desktop-motion.png') })
    await page.getByRole('button', { name: 'Pause background video' }).click()
    await page.waitForFunction(() => document.querySelector('#motion video').paused)
    await page.locator('#opening').evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
    await page.waitForTimeout(100)
    await page.locator('#motion').evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
    await page.waitForTimeout(100)
    assert.equal(await video.evaluate(el => el.paused), true, 'Manual pause persists after leaving the slide')
    await page.getByRole('button', { name: 'Play background video' }).click()
    await page.waitForFunction(() => !document.querySelector('#motion video').paused)
    await page.locator('#opening').evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
    await page.waitForFunction(() => document.querySelector('#motion video').paused)
    await page.locator('#motion').evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
    await page.waitForFunction(() => !document.querySelector('#motion video').paused)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => document.querySelector('#motion video').paused)
    assert.equal(await video.evaluate(el => getComputedStyle(el).opacity), '0')
  } finally { await page.close() }
})

test('background video: reduced motion, data saving and no-JS use a poster without downloading video', async () => {
  for (const mode of ['reduced', 'save-data', 'no-js']) {
    const requests = []
    const page = await openPage({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference', javaScriptEnabled: mode !== 'no-js' }, '/slides/motion/', async page => {
      page.on('request', request => { if (request.url().endsWith('.mp4')) requests.push(request.url()) })
      if (mode === 'save-data') {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true })
        })
      }
    })
    try {
      assert.deepEqual(requests, [])
      assert.equal(await page.locator('video').getAttribute('src'), null)
      assert.equal(await page.locator('video').evaluate(el => el.paused), true)
      assert.ok(await page.locator('.backdrop-image img').evaluate(el => el.complete && el.naturalWidth > 0))
      assert.equal(await page.locator('[data-video-toggle]').isVisible(), mode !== 'no-js')
      if (mode === 'reduced') {
        await page.getByRole('button', { name: 'Play background video' }).click()
        await page.waitForFunction(() => document.querySelector('video').currentTime > 0.2)
        await page.getByRole('button', { name: 'Pause background video' }).click()
      }
    } finally { await page.close() }
  }
})

test('background video: mobile inline playback and autoplay rejection fallback', async () => {
  const page = await openPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, '/slides/motion/', async page => {
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        HTMLMediaElement.prototype.play = play
        return Promise.reject(new DOMException('Autoplay denied for test', 'NotAllowedError'))
      }
    })
  })
  try {
    const video = page.locator('video')
    assert.equal(await video.evaluate(el => el.paused), true)
    assert.equal(await video.evaluate(el => getComputedStyle(el).opacity), '0')
    await page.getByRole('button', { name: 'Play background video' }).click()
    await page.waitForFunction(() => document.querySelector('video').currentTime > 0.2)
    assert.equal(await video.evaluate(el => el.playsInline), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(artifacts, 'mobile-motion.png') })
  } finally { await page.close() }
})

test('background video: decoder failure retains the poster and disables playback', async () => {
  const page = await openPage({}, '/slides/motion/', async page => {
    await page.route('**/slides/motion/flower.mp4', route => route.fulfill({ contentType: 'video/mp4', body: 'Invalid video for fallback test' }))
  })
  try {
    await page.waitForFunction(() => document.querySelector('video').error !== null)
    assert.equal(await page.getByRole('button', { name: 'Video unavailable' }).isDisabled(), true)
    assert.equal(await page.locator('video').evaluate(el => getComputedStyle(el).opacity), '0')
    assert.ok(await page.locator('.backdrop-image img').evaluate(el => el.complete && el.naturalWidth > 0))
  } finally { await page.close() }
})

test('contact: accessible validation, safe preview, edits and reset without side effects', async () => {
  const page = await openPage({ reducedMotion: 'reduce' }, '/slides/contact/')
  try {
    const form = page.locator('form[data-contact-form]')
    const preview = page.locator('[data-contact-preview]')
    const status = page.locator('[data-contact-status]')
    const submit = form.getByRole('button', { name: 'Preview message', exact: true })
    assert.equal(await form.getAttribute('method'), 'dialog')
    assert.equal(await form.locator('fieldset[data-contact-fields]').isDisabled(), false)
    assert.ok(await status.evaluate(el => el.hasAttribute('aria-live') || el.getAttribute('role') === 'status'))
    assert.equal(await preview.isHidden(), true)
    for (const [name, label] of Object.entries({ name: 'Name', email: 'Email', subject: 'Subject (optional)', message: 'Message' })) {
      const field = form.getByLabel(label, { exact: true })
      assert.equal(await field.getAttribute('name'), name)
      assert.equal(await field.evaluate(el => el.required), name !== 'subject')
    }
    const requests = []; const navigations = []
    page.on('request', request => requests.push(request.url()))
    page.on('framenavigated', frame => navigations.push(frame.url()))
    await page.evaluate(() => {
      window.contactStorageWrites = []
      for (const method of ['setItem', 'removeItem', 'clear']) {
        const original = Storage.prototype[method]
        Storage.prototype[method] = function (...args) {
          window.contactStorageWrites.push([method, ...args])
          return original.apply(this, args)
        }
      }
    })
    const initialURL = page.url()
    const initialCookies = await page.context().cookies()
    await submit.click()
    assert.equal(await form.getByLabel('Name', { exact: true }).evaluate(el => el === document.activeElement), true)
    for (const name of ['name', 'email', 'message']) {
      const field = form.locator(`[name="${name}"]`)
      assert.equal(await field.getAttribute('aria-invalid'), 'true')
      assert.ok((await field.getAttribute('aria-describedby') || '').split(/\s+/).includes(`contact-${name}-error`))
      assert.ok((await page.locator(`#contact-${name}-error`).innerText()).trim())
    }
    assert.equal(await preview.isHidden(), true)
    await form.getByLabel('Name', { exact: true }).fill('Ada')
    await form.getByLabel('Email', { exact: true }).fill('not-an-email')
    await form.getByLabel('Message', { exact: true }).fill('   123456789   ')
    await submit.click()
    assert.equal(await form.getByLabel('Email', { exact: true }).evaluate(el => el === document.activeElement), true)
    await form.getByLabel('Email', { exact: true }).fill('ada@example.com')
    await submit.click()
    assert.equal(await form.getByLabel('Message', { exact: true }).evaluate(el => el === document.activeElement), true)
    await form.getByLabel('Message', { exact: true }).fill('1234567890')
    await submit.click()
    assert.equal(await preview.isVisible(), true, 'Ten trimmed characters and an empty subject are valid')
    assert.equal(await status.textContent(), 'Preview ready. Nothing was sent or saved.')
    const values = { name: '<img src=x onerror=alert(1)>', email: 'ada@example.com', subject: '<b>Untrusted subject</b>', message: '<script>alert("preview")</script> A plain text message.' }
    for (const [name, value] of Object.entries(values)) {
      await form.locator(`[name="${name}"]`).fill(value)
      assert.equal(await preview.isHidden(), true, `Editing ${name} hides the preview`)
      await submit.click()
      assert.equal(await preview.isVisible(), true)
      assert.equal(await form.locator(`[name="${name}"]`).getAttribute('aria-invalid') === 'true', false)
    }
    for (const [name, value] of Object.entries(values)) {
      assert.equal(await preview.locator(`[data-preview-${name}]`).textContent(), value)
      assert.equal(await preview.locator(`[data-preview-${name}] > *`).count(), 0)
    }
    await form.getByRole('button', { name: 'Start over', exact: true }).click()
    for (const name of Object.keys(values)) {
      assert.equal(await form.locator(`[name="${name}"]`).inputValue(), '')
      assert.notEqual(await form.locator(`[name="${name}"]`).getAttribute('aria-invalid'), 'true')
    }
    assert.equal(await preview.isHidden(), true)
    assert.equal((await status.textContent()).trim(), '')
    await submit.click()
    await form.getByRole('button', { name: 'Start over', exact: true }).click()
    for (const name of ['name', 'email', 'message']) {
      assert.equal((await page.locator(`#contact-${name}-error`).textContent()).trim(), '')
      assert.notEqual(await form.locator(`[name="${name}"]`).getAttribute('aria-invalid'), 'true')
    }
    await page.waitForTimeout(100)
    assert.equal(page.url(), initialURL)
    assert.deepEqual(requests, [])
    assert.deepEqual(navigations, [])
    assert.deepEqual(await page.evaluate(() => window.contactStorageWrites), [])
    assert.deepEqual(await page.context().cookies(), initialCookies)
  } finally { await page.close() }
})

test('contact: no-JS form is disabled in source HTML and cannot submit', async () => {
  const html = await readFile(resolve(root, 'slides/contact/index.html'), 'utf8')
  assert.match(html, /<fieldset\b[^>]*data-contact-fields[^>]*>/)
  assert.match(html.match(/<fieldset\b[^>]*data-contact-fields[^>]*>/)[0], /\bdisabled(?:\s|=|>)/)
  const page = await openPage({ javaScriptEnabled: false }, '/slides/contact/')
  try {
    const form = page.locator('form[data-contact-form]')
    assert.equal(await form.getAttribute('method'), 'dialog')
    assert.equal(await form.locator('[data-contact-fields]').evaluate(el => el.disabled), true)
    for (const label of ['Name', 'Email', 'Subject (optional)', 'Message']) {
      assert.equal(await form.getByLabel(label, { exact: true }).isDisabled(), true)
    }
    assert.equal(await form.getByRole('button', { name: 'Preview message', exact: true }).isDisabled(), true)
    assert.equal(await form.getByRole('button', { name: 'Start over', exact: true }).isDisabled(), true)
    assert.equal(await page.locator('[data-contact-preview]').isHidden(), true)
  } finally { await page.close() }
})

test('contact: sequence, desktop screenshot and mobile preview overflow', async () => {
  const page = await openPage({ reducedMotion: 'reduce' }, '/#contact')
  try {
    assert.deepEqual(await page.locator('section.slide').evaluateAll(slides => slides.map(slide => slide.id)), ['opening', 'motion', 'interval', 'study', 'composition', 'collection', 'contact', 'colophon'])
    assert.deepEqual(await page.locator('.slide-number').allTextContents(), ['01', '02', '03', '04', '05', '06', '07', '08'])
    await page.locator('#contact').evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
    await page.screenshot({ path: resolve(artifacts, 'desktop-contact.png') })
  } finally { await page.close() }
  const mobile = await openPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }, '/#contact')
  try {
    const form = mobile.locator('form[data-contact-form]')
    await form.getByLabel('Name', { exact: true }).fill('A'.repeat(120))
    await form.getByLabel('Email', { exact: true }).fill('ada@example.com')
    await form.getByLabel('Subject (optional)', { exact: true }).fill('B'.repeat(120))
    await form.getByLabel('Message', { exact: true }).fill('C'.repeat(500))
    await form.getByRole('button', { name: 'Preview message', exact: true }).click()
    assert.equal(await mobile.locator('[data-contact-preview]').isVisible(), true)
    for (const width of [320, 390, 768]) {
      await mobile.setViewportSize({ width, height: 844 })
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Contact overflow at ${width}px`)
      assert.equal(await mobile.locator('[data-contact-preview]').evaluate(el => el.scrollWidth <= el.clientWidth), true, `Preview overflow at ${width}px`)
    }
    await mobile.setViewportSize({ width: 390, height: 844 })
    await form.getByRole('button', { name: 'Start over', exact: true }).click()
    await mobile.locator('#contact').evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
    await mobile.screenshot({ path: resolve(artifacts, 'mobile-contact.png') })
  } finally { await mobile.close() }
})

test('scrolling updates the hash without adding history or changing standalone URLs', async () => {
  const page = await openPage({ reducedMotion: 'reduce' }, '/?demo=1#study')
  try {
    await page.waitForFunction(() => location.hash === '#study' && document.querySelector('.chapter-nav a[href="/#study"]').hasAttribute('aria-current'))
    await page.waitForTimeout(200)
    const length = await page.evaluate(() => history.length)
    for (const id of ['composition', 'collection', 'contact', 'interval', 'opening']) {
      await page.locator(`#${id}`).evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'start' }))
      await page.waitForFunction(id => location.hash === `#${id}`, id)
      assert.ok(Math.abs((await page.locator(`#${id}`).boundingBox()).y) < 1, `${id} should align with the viewport top`)
      assert.equal(await page.evaluate(() => history.length), length)
      assert.equal(new URL(page.url()).search, '?demo=1')
      assert.equal(await page.locator(`.chapter-nav a[href="/#${id}"]`).getAttribute('aria-current'), 'location')
    }
    await page.goto(`${origin}/slides/collection/`)
    await page.evaluate(() => scrollTo(0, 500))
    await page.waitForTimeout(300)
    assert.equal(new URL(page.url()).hash, '')
  } finally { await page.close() }
})

test('fixed Study backdrop stays viewport-anchored through entry and exit', async () => {
  for (const width of [390, 1440]) {
    const page = await openPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce', javaScriptEnabled: false })
    try {
      const slide = page.locator('#study')
      const backdrop = slide.locator('.slide-backdrop')
      const bounds = await slide.evaluate(el => ({ top: el.getBoundingClientRect().top + scrollY, height: el.offsetHeight }))
      for (const [phase, top] of [['entry', bounds.top - 450], ['middle', bounds.top + 300], ['exit', bounds.top + bounds.height - 450]]) {
        await page.evaluate(top => scrollTo({ top, behavior: 'instant' }), top)
        const box = await backdrop.boundingBox()
        assert.ok(Math.abs(box.y) < 1, `${width}px ${phase}: backdrop top ${box.y}`)
        assert.equal(Math.round(box.height), 900)
        assert.equal(Math.round(box.width), width)
        assert.equal(await slide.evaluate(el => getComputedStyle(el).clipPath), 'inset(0px)')
        if (phase === 'entry') await page.screenshot({ path: resolve(artifacts, `fixed-study-${width}.png`) })
      }
      assert.equal(await page.locator('#opening .slide-backdrop').evaluate(el => getComputedStyle(el).position), 'sticky')
    } finally { await page.close() }
  }
})

test('no browser exceptions, failed assets or external requests', () => {
  assert.deepEqual(failures, [])
})
