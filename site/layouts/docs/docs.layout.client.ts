/// <reference lib="dom" />

const navigation = document.querySelector<HTMLDetailsElement>('.docs-navigation')
const links = Array.from(navigation?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])
const headings = Array.from(document.querySelectorAll<HTMLElement>('#docs-content h2[id], #docs-content h3[id], #docs-content h4[id]'))
// Keep this breakpoint in sync with docs.layout.css.
const desktop = matchMedia('(min-width: 64rem)')

function decodedHash (hash: string): string {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

function fragmentTarget (hash: string): HTMLElement | null {
  const id = hash.slice(1)
  return document.getElementById(id) ?? document.getElementById(decodedHash(id))
}

function sectionLink (target: HTMLElement | null): HTMLAnchorElement | undefined {
  const findLink = (id: string): HTMLAnchorElement | undefined =>
    links.find(link => link.pathname === location.pathname && link.hash !== '' && fragmentTarget(link.hash)?.id === id)
  if (!target) return
  const exact = findLink(target.id)
  if (exact) return exact
  // The shared ToC includes h2/h3. Deeper headings belong to the nearest
  // preceding section that is represented there.
  const index = headings.indexOf(target)
  if (index < 0) return
  for (const heading of headings.slice(0, index).reverse()) {
    const link = findLink(heading.id)
    if (link) return link
  }
}

function updateLocation (reveal: boolean): void {
  // The browser accepts both literal and decoded fragments. Markdown heading
  // IDs can themselves contain percent escapes. Resolve the same target before
  // the browser's initial fragment scroll (when :target may not yet be set).
  const currentSection = sectionLink(fragmentTarget(location.hash))
  let active: HTMLAnchorElement | undefined
  for (const link of links) {
    const samePage = link.pathname === location.pathname
    const sameSection = link === currentSection
    if (sameSection || (samePage && !link.hash)) {
      link.setAttribute('aria-current', sameSection ? 'location' : 'page')
    } else {
      link.removeAttribute('aria-current')
    }
    if (sameSection) active = link
  }
  active ??= links.find(link => link.getAttribute('aria-current') === 'page')
  if (!active) return
  const section = active.closest('details')
  if (section) section.open = true
  if (reveal && navigation && (desktop.matches || navigation.closest('dialog[open]'))) {
    // Scroll only the sidebar, never the document away from its anchor.
    const bounds = navigation.getBoundingClientRect()
    const linkBounds = active.getBoundingClientRect()
    if (linkBounds.top < bounds.top || linkBounds.bottom > bounds.bottom) {
      navigation.scrollTop += linkBounds.top - bounds.top
    }
  }
}

/**
 * Scrolling describes the reading position; it must never navigate or focus.
 * Replace the current history entry, preserving its state and query string.
 * Native fragment navigation wins over a pending scroll update.
 */
function trackReadingPosition (): void {
  let pending: ReturnType<typeof setTimeout> | undefined
  let lastScrollY = scrollY
  let navigating = false
  const cancel = (): void => {
    clearTimeout(pending)
    pending = undefined
  }
  const finishNavigation = (): void => {
    cancel()
    lastScrollY = scrollY
    navigating = false
  }
  const waitForNavigation = (): void => {
    cancel()
    // Also handles browsers without scrollend, and links that don't move the
    // page. Each animation frame's scroll event postpones this idle fallback.
    pending = setTimeout(finishNavigation, 150)
  }
  const beginNavigation = (): void => {
    navigating = true
    waitForNavigation()
  }
  const update = (): void => {
    pending = undefined
    if (scrollY === lastScrollY || document.querySelector('.docs-menu[open]')) return
    lastScrollY = scrollY
    const threshold = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
    let current: HTMLElement | undefined
    for (const heading of headings) {
      if (!heading.getClientRects().length) continue // Ignore closed disclosures.
      if (heading.getBoundingClientRect().top > threshold + 1) break
      current = heading
    }
    const hash = current ? `#${encodeURIComponent(current.id)}` : ''
    if (fragmentTarget(location.hash) === current || location.hash === hash) return
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`)
    updateLocation(true) // replaceState does not emit hashchange.
  }
  addEventListener('hashchange', beginNavigation)
  addEventListener('popstate', beginNavigation)
  addEventListener('scrollend', () => {
    if (navigating) finishNavigation()
  })
  // Initial deep links, anchor animations, and history restoration choose their
  // own URL. Resume reading-position tracking only after that scroll settles.
  const start = (): void => {
    beginNavigation()
    addEventListener('scroll', () => {
      if (navigating) waitForNavigation()
      // Throttle, not debounce: keep the URL current during continuous reading.
      else pending ??= setTimeout(update, 300)
    }, { passive: true })
  }
  if (document.readyState === 'complete') start()
  else addEventListener('load', start, { once: true })
}

/**
 * One server-rendered navigation tree has two homes: the desktop sidebar and
 * a native modal dialog on small screens. Without this enhancement it stays
 * an ordinary details disclosure in the document.
 */
function enhanceMenu (): void {
  const shell = document.querySelector<HTMLElement>('.docs-shell')
  const content = document.getElementById('docs-content')
  const dialog = document.querySelector<HTMLDialogElement>('.docs-menu')
  const toggle = document.querySelector<HTMLButtonElement>('.site-menu-toggle')
  if (!navigation || !shell || !content || !dialog || !toggle || typeof dialog.showModal !== 'function') return
  const nav = navigation
  shell.setAttribute('data-navigation-enhanced', '')

  const updateMenuState = (): void => {
    toggle.setAttribute('aria-expanded', String(dialog.open))
  }

  const updateMenuLayout = (): void => {
    const hadFocus = dialog.contains(document.activeElement)
    const hadNavigationFocus = nav.contains(document.activeElement)
    if (desktop.matches) {
      dialog.close()
      shell.insertBefore(nav, content)
      if (hadFocus) nav.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.focus({ preventScroll: true })
    } else {
      dialog.append(nav)
    }
    nav.open = true
    toggle.hidden = desktop.matches
    if (!desktop.matches && hadNavigationFocus) toggle.focus({ preventScroll: true })
    updateMenuState()
    updateLocation(true)
  }

  toggle.addEventListener('click', () => {
    dialog.showModal()
    updateMenuState()
    updateLocation(true)
  })
  dialog.addEventListener('close', updateMenuState)
  // Native dialog handles Escape, focus containment, and return to the opener.
  // Close on backdrop clicks too, without treating clicks inside as dismissals.
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close()
  })
  nav.addEventListener('click', event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (!link || !dialog.open || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const sameDocument = link.origin === location.origin && link.pathname === location.pathname && link.search === location.search
    if (!sameDocument) return // A cross-page navigation unloads the document.
    dialog.close()
    const target = fragmentTarget(link.hash) ?? content
    const hadTabindex = target.hasAttribute('tabindex')
    if (!hadTabindex) target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
    if (!hadTabindex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
    // Let the browser perform the link's normal fragment navigation.
  })
  desktop.addEventListener('change', updateMenuLayout)
  updateMenuLayout()
}

enhanceMenu()
updateLocation(true)
addEventListener('hashchange', () => updateLocation(true))
trackReadingPosition()
