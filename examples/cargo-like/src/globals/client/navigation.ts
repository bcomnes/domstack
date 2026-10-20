/// <reference lib="dom" />
export function initializeMenu () {
  const header = document.querySelector<HTMLElement>('.site-header')
  const toggle = header?.querySelector<HTMLButtonElement>('.menu-toggle')
  const nav = header?.querySelector<HTMLElement>('.chapter-nav')
  const mobile = window.matchMedia('(max-width: 700px)')

  function closeMenu (restoreFocus = false) {
    const wasOpen = toggle?.getAttribute('aria-expanded') === 'true'
    toggle?.setAttribute('aria-expanded', 'false')
    nav?.classList.remove('is-open')
    if (restoreFocus && wasOpen) toggle?.focus()
  }

  if (toggle && nav) {
    nav.id = toggle.getAttribute('aria-controls') || nav.id || 'chapter-nav'
    toggle.setAttribute('aria-controls', nav.id)
    toggle.setAttribute('aria-expanded', 'false')
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true'
      toggle.setAttribute('aria-expanded', String(open))
      nav.classList.toggle('is-open', open)
    })
    nav.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a')) closeMenu(true)
    })
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        closeMenu(true)
      }
    })
    document.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Node && !header?.contains(event.target)) closeMenu()
    })
    header?.addEventListener('focusout', (event) => {
      if (event.relatedTarget instanceof Node && !header.contains(event.relatedTarget)) closeMenu()
    })
    mobile.addEventListener('change', () => closeMenu())
  }
}

export function initializeActiveChapter () {
  const sections = [...document.querySelectorAll<HTMLElement>('section.slide[id]')]
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.chapter-nav a')]

  // Keep native anchor history and focus behavior; standalone links must still navigate home.
  function linkTarget (link: HTMLAnchorElement) {
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin) return null
    try { return decodeURIComponent(url.hash.slice(1)) } catch { return null }
  }
  let activeId: string | undefined
  let hashTimer: ReturnType<typeof setTimeout> | undefined
  const isStack = document.body.dataset['view'] === 'stack'

  function scheduleHashUpdate () {
    if (!isStack) return
    clearTimeout(hashTimer)
    // Wait for scrolling to settle so native smooth anchor navigation keeps its target.
    hashTimer = setTimeout(() => {
      if (!activeId) return
      const url = new URL(location.href)
      const hash = `#${activeId}`
      if (url.hash === hash) return
      url.hash = hash
      history.replaceState(history.state, '', url)
    }, 150)
  }
  if (isStack) window.addEventListener('scroll', scheduleHashUpdate, { passive: true })

  function setActive (id: string) {
    activeId = id
    for (const link of links) {
      if (linkTarget(link) === id) link.setAttribute('aria-current', 'location')
      else link.removeAttribute('aria-current')
    }
  }
  if (sections[0]) setActive(sections[0].id)
  if ('IntersectionObserver' in window) {
    const visible = new Map<HTMLElement, number>()
    const activeObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const section = entry.target as HTMLElement
        if (entry.isIntersecting) visible.set(section, entry.boundingClientRect.top)
        else visible.delete(section)
      }
      const active = [...visible.keys()].sort((a, b) =>
        Math.abs(a.getBoundingClientRect().top) - Math.abs(b.getBoundingClientRect().top)
      )[0]
      if (active) {
        setActive(active.id)
        scheduleHashUpdate()
      }
    }, { rootMargin: '-15% 0px -55% 0px', threshold: 0 })
    sections.forEach((section) => activeObserver.observe(section))
  }
}
