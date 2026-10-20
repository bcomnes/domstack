/// <reference lib="dom" />
import PhotoSwipeLightbox from 'photoswipe/lightbox'
// @ts-expect-error The caption plugin does not publish TypeScript declarations.
import PhotoSwipeDynamicCaption from 'photoswipe-dynamic-caption-plugin'

export function initializeLightbox () {
  if (!document.querySelector('.photo-grid [data-lightbox]')) return
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const lightbox = new PhotoSwipeLightbox({
    gallery: '.photo-grid',
    children: 'a[data-lightbox]',
    pswpModule: () => import('photoswipe'),
    bgOpacity: 1,
    mainClass: 'field-gallery',
    closeTitle: 'Close photograph viewer',
    arrowPrevTitle: 'Previous photograph',
    arrowNextTitle: 'Next photograph',
    zoomTitle: 'Zoom photograph',
    showHideAnimationType: reducedMotion.matches ? 'none' : 'zoom',
    zoomAnimationDuration: reducedMotion.matches ? 0 : 333,
  })
  // The plugin constructor registers its hooks on the lightbox.
  // eslint-disable-next-line no-new
  new PhotoSwipeDynamicCaption(lightbox, {
    type: 'below',
    captionContent: (slide: { data: { element?: HTMLElement } }) => {
      const element = slide.data.element
      const text = element?.getAttribute('data-caption') || element?.querySelector('img')?.alt || ''
      // The plugin accepts HTML; authored captions must remain plain text.
      const container = document.createElement('span')
      container.textContent = text
      return container.innerHTML
    },
  })
  lightbox.on('keydown', event => {
    const key = event.originalEvent
    const pswp = lightbox.pswp
    if (!pswp?.options.arrowKeys || pswp.getNumItems() < 2 || reducedMotion.matches) return
    if (key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) return
    if (key.key !== 'ArrowLeft' && key.key !== 'ArrowRight') return
    event.preventDefault()
    key.preventDefault()
    pswp.mainScroll.moveIndexBy(key.key === 'ArrowRight' ? 1 : -1, true)
  })
  lightbox.on('beforeOpen', () => {
    lightbox.options.showHideAnimationType = reducedMotion.matches ? 'none' : 'zoom'
    lightbox.options.zoomAnimationDuration = reducedMotion.matches ? 0 : 333
  })
  lightbox.init()
}
