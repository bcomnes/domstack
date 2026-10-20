/// <reference lib="dom" />
export function initializeScrollProgress () {
  const progress = document.querySelector<HTMLElement>('.scroll-progress')
  if (progress) {
    progress.setAttribute('aria-hidden', 'true')
    let scheduled = false
    const updateProgress = () => {
      const distance = document.documentElement.scrollHeight - window.innerHeight
      const fraction = distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0
      progress.style.transform = `scaleX(${fraction})`
      scheduled = false
    }
    const scheduleProgress = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(updateProgress)
    }
    window.addEventListener('scroll', scheduleProgress, { passive: true })
    window.addEventListener('resize', scheduleProgress)
    if ('ResizeObserver' in window) new ResizeObserver(scheduleProgress).observe(document.body)
    updateProgress()
  }
}
