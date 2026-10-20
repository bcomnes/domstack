/// <reference lib="dom" />
import { initializeMenu, initializeActiveChapter } from './client/navigation.ts'
import { initializeTextFitting } from './client/fit-text.ts'
import { initializePointerRotation } from './client/pointer-rotate.ts'
import { initializeReveals } from './client/reveal.ts'
import { initializeScrollProgress } from './client/scroll-progress.ts'
import { initializeDragging } from './client/drag.ts'
import { initializeLightbox } from './client/lightbox.ts'
import { initializeBackgroundVideos } from './client/background-video.ts'

import { initializeContactForms } from './client/contact-form.ts'

function initializeCargoLike () {
  if (document.body.classList.contains('field-ready')) return

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  initializeMenu()
  document.body.classList.add('field-ready')
  initializeTextFitting()
  initializePointerRotation(reducedMotion)
  initializeActiveChapter()
  initializeReveals(reducedMotion)
  initializeScrollProgress()
  initializeDragging()
  initializeLightbox()
  initializeBackgroundVideos(reducedMotion)
  initializeContactForms()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeCargoLike, { once: true })
} else {
  initializeCargoLike()
}
