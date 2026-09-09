/// <reference lib="dom" />

const navigation = document.querySelector<HTMLDetailsElement>('.docs-navigation')
const links = Array.from(navigation?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])
const desktop = matchMedia('(min-width: 82rem)')

function updateDisclosure (): void {
  if (navigation) navigation.open = desktop.matches
}

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
  if (!active) return
  const section = active.closest('details')
  if (section) section.open = true
  if (reveal && desktop.matches && navigation) {
    // Scroll only the sidebar, never the document away from its anchor.
    const bounds = navigation.getBoundingClientRect()
    const linkBounds = active.getBoundingClientRect()
    if (linkBounds.top < bounds.top || linkBounds.bottom > bounds.bottom) {
      navigation.scrollTop += linkBounds.top - bounds.top
    }
  }
}

updateDisclosure()
updateLocation(true)
desktop.addEventListener('change', updateDisclosure)
addEventListener('hashchange', () => updateLocation(true))
