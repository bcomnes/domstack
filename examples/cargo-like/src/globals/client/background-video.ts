/// <reference lib="dom" />
export function initializeBackgroundVideos (reducedMotion: MediaQueryList) {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; addEventListener?: (type: string, listener: () => void) => void };
  }).connection

  document.querySelectorAll<HTMLVideoElement>('[data-background-video]').forEach(video => {
    const slide = video.closest<HTMLElement>('.slide')
    const button = slide?.querySelector<HTMLButtonElement>('[data-video-toggle]')
    if (!slide || !button) return

    let visible = false
    let userChoice: boolean | null = null
    let blocked = false
    let failed = false
    video.muted = true
    video.defaultMuted = true
    button.hidden = false

    function shouldPlay () {
      const permitted = userChoice ?? (!reducedMotion.matches && !connection?.saveData)
      return visible && !document.hidden && permitted && !blocked && !failed
    }
    function updateControl () {
      const label = failed ? 'Video unavailable' : video.paused ? 'Play background video' : 'Pause background video'
      button!.setAttribute('aria-label', label)
      button!.title = label
      button!.querySelector('[data-video-icon]')?.setAttribute('d',
        failed ? 'm6 6 12 12M18 6 6 18' : video.paused ? 'm8 5 11 7-11 7Z' : 'M8 5v14M16 5v14')
      button!.disabled = failed
      video.classList.toggle('is-playing', !video.paused && !failed)
    }
    function synchronize () {
      if (!shouldPlay()) {
        video.pause()
        updateControl()
        return
      }
      // Do not fetch video bytes until playback is actually allowed and the slide is visible.
      if (!video.getAttribute('src')) video.src = video.dataset['src']!
      if (!video.paused) return
      video.play().catch((error: unknown) => {
        // Scrolling away can interrupt an in-flight play request. That is not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return
        blocked = true
        video.pause()
        updateControl()
      })
    }

    button.addEventListener('click', () => {
      userChoice = video.paused
      blocked = false
      synchronize()
    })
    video.addEventListener('playing', () => {
      if (!shouldPlay()) video.pause()
      updateControl()
    })
    video.addEventListener('pause', updateControl)
    video.addEventListener('error', () => {
      failed = true
      video.pause()
      updateControl()
    })
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches && userChoice === true) userChoice = null
      synchronize()
    })
    connection?.addEventListener?.('change', synchronize)
    document.addEventListener('visibilitychange', synchronize)

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? false
        synchronize()
      })
      // Observe the whole section, not its pinned media rectangle.
      observer.observe(slide)
    } else {
      // Keep a static poster when visibility cannot be observed, but allow explicit playback.
      visible = true
      userChoice = false
    }
    updateControl()
  })
}
