/// <reference lib="dom" />

const navigation = document.querySelector<HTMLDetailsElement>('.docs-navigation')
const links = Array.from(navigation?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])
// Keep this breakpoint in sync with docs.layout.css.
const desktop = matchMedia('(min-width: 64rem)')

function decodedHash (hash: string): string {
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

function updateLocation (reveal: boolean): void {
  // The browser accepts both literal and decoded fragments. Markdown heading
  // IDs can themselves contain percent escapes. Resolve the same target before
  // the browser's initial fragment scroll (when :target may not yet be set).
  const hash = location.hash.slice(1)
  const targetId = (document.getElementById(hash) ?? document.getElementById(decodedHash(hash)))?.id
  let active: HTMLAnchorElement | undefined
  for (const link of links) {
    const samePage = link.pathname === location.pathname
    const sameSection = samePage && link.hash !== '' && decodedHash(link.hash).slice(1) === targetId
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
    const id = link.hash.slice(1)
    const target = document.getElementById(id) ?? document.getElementById(decodedHash(id)) ?? content
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
