/// <reference lib="dom" />

function followMovedReference (): void {
  let id: string
  try {
    id = decodeURIComponent(location.hash.slice(1))
  } catch {
    return
  }
  const destination = (document.getElementById(location.hash.slice(1)) ?? document.getElementById(id))?.dataset.referenceUrl
  if (destination) location.replace(new URL(destination, location.href))
}

followMovedReference()
addEventListener('hashchange', followMovedReference)

const toc = document.querySelector<HTMLElement>('.table-of-contents')
const tocLinks = Array.from(toc?.querySelectorAll<HTMLAnchorElement>('a[href^="#"]') ?? [])
const main = toc?.closest<HTMLElement>('.app-main')
const tocHeading = document.getElementById('table-of-contents')
const originalMainChildren = Array.from(main?.children ?? [])
const documentContent = document.createElement('div')
const sidebarMedia = matchMedia('(min-width: 82rem)')
documentContent.className = 'docs-content'

function updateTocLayout (): void {
  if (!main || !toc || !tocHeading) return

  if (sidebarMedia.matches) {
    documentContent.replaceChildren(
      ...originalMainChildren.filter(element => element !== toc && element !== tocHeading)
    )
    main.replaceChildren(toc, documentContent)
    main.classList.add('has-sidebar-toc')
  } else {
    main.replaceChildren(...originalMainChildren)
    main.classList.remove('has-sidebar-toc')
  }
}

function revealTocLink (link: HTMLAnchorElement): void {
  if (!toc || toc.scrollHeight <= toc.clientHeight) return

  const tocBounds = toc.getBoundingClientRect()
  const linkBounds = link.getBoundingClientRect()

  if (linkBounds.top < tocBounds.top) {
    toc.scrollBy({ top: linkBounds.top - tocBounds.top })
  } else if (linkBounds.bottom > tocBounds.bottom) {
    toc.scrollBy({ top: linkBounds.bottom - tocBounds.bottom })
  }
}

function updateActiveTocLink (reveal: boolean): void {
  const activeHash = decodeURIComponent(location.hash)
  let activeLink: HTMLAnchorElement | undefined

  for (const link of tocLinks) {
    const matchesHash = decodeURIComponent(link.hash) === activeHash
    link.toggleAttribute('aria-current', matchesHash)
    if (matchesHash) {
      link.setAttribute('aria-current', 'location')
      activeLink = link
    }
  }

  if (reveal && activeLink) revealTocLink(activeLink)
}

updateTocLayout()
updateActiveTocLink(true)

sidebarMedia.addEventListener('change', updateTocLayout)
addEventListener('hashchange', () => updateActiveTocLink(false))
