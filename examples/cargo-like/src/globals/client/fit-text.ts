/// <reference lib="dom" />
export function initializeTextFitting () {
  // Measure actual glyphs rather than stretching the text or relying on a viewport guess.
  const fitted = [...document.querySelectorAll<HTMLElement>('[data-fit-text]')]
  function fitText () {
    for (const line of fitted) {
      const width = line.parentElement?.clientWidth
      if (!width || !line.textContent?.trim()) continue
      let size = 100
      const range = document.createRange()
      range.selectNodeContents(line)
      for (let pass = 0; pass < 3; pass++) {
        line.style.setProperty('--fit-size', `${size}px`)
        const measured = range.getBoundingClientRect().width
        if (!measured) break
        size = Math.min(800, size * width * 0.98 / measured)
      }
      line.style.setProperty('--fit-size', `${size}px`)
    }
  }
  fitText()
  document.fonts.ready.then(fitText)
  document.fonts.addEventListener('loadingdone', fitText)
  if ('ResizeObserver' in window) {
    const widths = new WeakMap<Element, number>()
    const observer = new ResizeObserver(entries => {
      let changed = false
      for (const entry of entries) {
        if (widths.get(entry.target) === entry.contentRect.width) continue
        widths.set(entry.target, entry.contentRect.width)
        changed = true
      }
      if (changed) fitText()
    })
    for (const line of fitted) if (line.parentElement) observer.observe(line.parentElement)
  }
  window.addEventListener('resize', fitText)
}
