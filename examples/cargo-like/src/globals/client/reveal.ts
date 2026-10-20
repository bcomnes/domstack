/// <reference lib="dom" />
export function initializeReveals (reducedMotion: MediaQueryList) {
  if (!('IntersectionObserver' in window)) return

  const revealElements = [...document.querySelectorAll<HTMLElement>('[data-reveal]')]
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.remove('reveal-pending')
      revealObserver.unobserve(entry.target)
    }
  }, { threshold: 0, rootMargin: '0px 0px -24px 0px' })
  if (!reducedMotion.matches) {
    for (const element of revealElements) {
      // Only defer content below the viewport, never the initial reading area.
      if (element.getBoundingClientRect().top < window.innerHeight) continue
      element.classList.add('reveal-ready', 'reveal-pending')
      revealObserver.observe(element)
    }
  }
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return
    revealObserver.disconnect()
    revealElements.forEach((element) => element.classList.remove('reveal-pending'))
  })
}
