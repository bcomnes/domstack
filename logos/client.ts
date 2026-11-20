/// <reference lib="dom" />
import PhotoSwipeLightbox from 'photoswipe/lightbox'
// @ts-expect-error The caption plugin does not publish TypeScript declarations.
import PhotoSwipeDynamicCaption from 'photoswipe-dynamic-caption-plugin'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const lightbox = new PhotoSwipeLightbox({
  gallery: '#main-content',
  children: '.artwork-grid a',
  returnFocus: false,
  pswpModule: () => import('photoswipe'),
  showHideAnimationType: reducedMotion.matches ? 'none' : 'zoom',
  zoomAnimationDuration: reducedMotion.matches ? 0 : 333,
})

const darkTheme = window.matchMedia('(prefers-color-scheme: dark)')
const artworkLinks = document.querySelectorAll<HTMLAnchorElement>('.artwork-grid a')
function syncArtworkLinks () {
  artworkLinks.forEach((link, index) => {
    const night = link.querySelector('source')
    const day = link.querySelector('img')
    if (!night || !day) return
    link.href = darkTheme.matches ? night.srcset : day.src
    lightbox.pswp?.refreshSlideContent(index)
  })
}
syncArtworkLinks()
darkTheme.addEventListener('change', syncArtworkLinks)

// eslint-disable-next-line no-new
new PhotoSwipeDynamicCaption(lightbox, { type: 'auto' })

lightbox.on('beforeOpen', () => {
  const viewer = lightbox.pswp
  if (!viewer) return
  // Arrow buttons and keyboard shortcuts share these two navigation actions.
  viewer.next = () => { viewer.mainScroll.moveIndexBy(1, !reducedMotion.matches) }
  viewer.prev = () => { viewer.mainScroll.moveIndexBy(-1, !reducedMotion.matches) }

  // PhotoSwipe also emits change before the opening zoom, while measuring its source.
  viewer.on('change', () => {
    if (viewer.opener.isOpen) {
      viewer.currSlide?.data.element?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  })
  viewer.on('close', () => {
    viewer.currSlide?.data.element?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  })
  viewer.on('destroy', () => {
    viewer.currSlide?.data.element?.focus({ preventScroll: true })
  })
})
lightbox.init()
