/// <reference lib="dom" />
import { illustrationFile } from './site/lib/illustration-file.ts'

const readmeLogo = document.querySelector<HTMLPictureElement>('main > h1#domstack > picture')
if (readmeLogo) {
  const designs = [
    'bosch-penwork', 'espalier', 'folio-bindery', 'folio-brewery',
    'folio-choir', 'folio-herb-garden', 'folio-initial', 'folio-ivy', 'folio-scribe',
  ]
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'readme-logo-cycle'
  button.title = 'Show next DOMStack illustration'
  button.setAttribute('aria-label', button.title)
  readmeLogo.replaceWith(button)
  button.append(readmeLogo)

  let index = Math.floor(Math.random() * designs.length)
  let latestRequest = 0
  function showDesign (fade = false) {
    const requested = ++latestRequest
    const design = designs[index]
    const picture = document.createElement('picture')
    const dark = document.createElement('source')
    dark.media = '(prefers-color-scheme: dark)'
    dark.srcset = `./site/logos/${illustrationFile(design, true)}`
    const logo = new Image(1200, 630)
    picture.append(dark, logo)
    logo.alt = 'domstack'
    logo.addEventListener('load', () => {
      if (requested !== latestRequest) return
      const previous = button.lastElementChild
      if (!fade || !previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        button.replaceChildren(picture)
        return
      }

      button.append(picture)
      const timing = { duration: 300, easing: 'ease-in-out' }
      picture.animate([{ opacity: 0 }, { opacity: 1 }], timing)
      const outgoing = previous.animate([{ opacity: getComputedStyle(previous).opacity }, { opacity: 0 }], timing)
      outgoing.onfinish = () => previous.remove()
    }, { once: true })
    logo.src = `./site/logos/${illustrationFile(design)}`
  }

  button.addEventListener('click', () => {
    index = (index + 1) % designs.length
    showDesign(true)
  })
  showDesign()
}
