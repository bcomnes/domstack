/// <reference lib="dom" />
export function initializePointerRotation (reducedMotion: MediaQueryList) {
  const rotating = [...document.querySelectorAll<HTMLElement>('[data-pointer-rotate]')]
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
  let rotateFrame = 0
  window.addEventListener('pointermove', event => {
    if (reducedMotion.matches || !finePointer.matches || event.pointerType !== 'mouse') return
    cancelAnimationFrame(rotateFrame)
    rotateFrame = requestAnimationFrame(() => {
      for (const element of rotating) {
        const rect = element.getBoundingClientRect()
        if (rect.bottom < 0 || rect.top > innerHeight) continue
        const angle = Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2)
        element.style.setProperty('--pointer-rotate', `${angle * 180 / Math.PI}deg`)
      }
    })
  }, { passive: true })
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return
    cancelAnimationFrame(rotateFrame)
    rotating.forEach(element => element.style.removeProperty('--pointer-rotate'))
  })
}
