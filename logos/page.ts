import { html, render } from 'fragtml'
import { illustrationFile } from '../site/lib/illustration-file.ts'

export const vars = {
  title: 'Logos',
  description: 'Browse DOMStack’s illustrated folios, layer diagrams, wordmarks, and icons.',
}

type Artwork = [file: string, label: string, width: number, height: number, nightFile?: string]

function gallery (title: string, works: Artwork[]) {
  return html`
    <section>
      <h2>${title}</h2>
      <ul class="artwork-grid">
        ${works.map(([file, label, width, height, nightFile]) => html`
          <li><a href="${file}" data-pswp-width="${width}" data-pswp-height="${height}">
            <picture>
              ${nightFile ? html`<source media="(prefers-color-scheme: dark)" srcset="${nightFile}" />` : null}
              <img src="${file}" alt="${label}" width="${width}" height="${height}" loading="lazy" />
            </picture>
          </a></li>
        `)}
      </ul>
    </section>
  `
}

export default function page () {
  const logos = '../site/logos/domstack-'
  const icons = '../site/icons/'
  const illustrations = [
    ['bosch-penwork', 'Bosch’s workshop'],
    ['folio-scribe', 'The scribe'],
    ['folio-bindery', 'The monastery bindery'],
    ['folio-brewery', 'The abbey brewery'],
    ['folio-choir', 'The choir sings HTML'],
    ['folio-herb-garden', 'The cloister herb garden'],
    ['folio-initial', 'Illuminated initial'],
    ['folio-ivy', 'Ivy manuscript'],
    ['espalier', 'Espalier pear tree'],
  ]
  return render(html`
    <h1>Logos</h1>
    ${gallery('Illustrations', illustrations.map(([slug, label]) => [
      `../site/logos/${illustrationFile(slug)}`, label, 1200, 630, `../site/logos/${illustrationFile(slug, true)}`,
    ]))}
    ${gallery('Layer diagrams', [
      [`${logos}layers.png`, 'Illuminated layers', 1536, 1024],
      [`${logos}layers-arch.png`, 'Books beneath a Gothic arch', 1536, 1024],
    ])}
    ${gallery('Wordmarks and icons', [
      [`${icons}domstack-social.png`, 'Horizontal wordmark', 1200, 630],
      [`${logos}ios-light.png`, 'Stacked wordmark · light', 1024, 1024],
      [`${logos}ios-dark.png`, 'Stacked wordmark · dark', 1024, 1024],
      ...[180, 167, 152].map((size): Artwork => [
        `${icons}apple-touch-icon-${size}.png`, `Apple touch icon · ${size} px`, size, size,
      ]),
      [`${icons}favicon-light.png`, 'Favicon · light', 32, 32],
      [`${icons}favicon-dark.png`, 'Favicon · dark', 32, 32],
      ['../favicon.ico', 'Multi-size favicon', 48, 48],
    ])}
  `)
}
