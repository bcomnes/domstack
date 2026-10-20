/// <reference lib="dom" />
export function initializeDragging () {
  document.querySelectorAll<HTMLElement>('[data-drag]').forEach((sticker) => {
    const container = sticker.parentElement
    if (!container) return
    let x = 0
    let y = 0
    let pointer: number | null = null
    let startX = 0
    let startY = 0
    let originX = 0
    let originY = 0
    sticker.classList.add('is-draggable')
    if (sticker.tabIndex < 0) sticker.tabIndex = 0
    sticker.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Home')
    const hint = document.createElement('span')
    hint.id = `drag-hint-${[...document.querySelectorAll('[data-drag]')].indexOf(sticker)}`
    hint.hidden = true
    hint.textContent = 'Drag to move, or use arrow keys. Hold Shift for larger steps. Press Home to reset.'
    sticker.after(hint)
    sticker.setAttribute('aria-describedby', [sticker.getAttribute('aria-describedby'), hint.id].filter(Boolean).join(' '))

    function move (nextX: number, nextY: number) {
      const bounds = container!.getBoundingClientRect()
      const rect = sticker.getBoundingClientRect()
      const left = rect.left - x
      const top = rect.top - y
      const minX = bounds.left - left
      const maxX = bounds.right - (left + rect.width)
      const minY = bounds.top - top
      const maxY = bounds.bottom - (top + rect.height)
      x = Math.max(minX, Math.min(Math.max(minX, maxX), nextX))
      y = Math.max(minY, Math.min(Math.max(minY, maxY), nextY))
      sticker.style.setProperty('--drag-x', `${x}px`)
      sticker.style.setProperty('--drag-y', `${y}px`)
    }
    sticker.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0 || pointer !== null) return
      pointer = event.pointerId
      startX = event.clientX
      startY = event.clientY
      originX = x
      originY = y
      sticker.setPointerCapture(pointer)
      sticker.classList.add('is-dragging')
      sticker.focus({ preventScroll: true })
    })
    sticker.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointer) return
      move(originX + event.clientX - startX, originY + event.clientY - startY)
    })
    const stop = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      pointer = null
      sticker.classList.remove('is-dragging')
      if (sticker.hasPointerCapture(event.pointerId)) sticker.releasePointerCapture(event.pointerId)
    }
    sticker.addEventListener('pointerup', stop)
    sticker.addEventListener('pointercancel', stop)
    sticker.addEventListener('lostpointercapture', stop)
    sticker.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 24 : 8
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
      }
      const direction = directions[event.key]
      if (event.key === 'Home') {
        event.preventDefault()
        move(0, 0)
      } else if (direction) {
        event.preventDefault()
        const [dx, dy] = direction
        move(x + dx, y + dy)
      }
    })
    if ('ResizeObserver' in window) new ResizeObserver(() => move(x, y)).observe(container)
  })
}
