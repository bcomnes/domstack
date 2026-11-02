/**
 * @import { PageFunction } from '#types'
 * @import { CompositionData } from './global.data.js'
 */

export const vars = { title: 'Composition pages', dataDeps: ['slides', 'slidePreview', 'pageCompositions'] }

/** @type {PageFunction<{ title: string }, string, CompositionData>} */
export default ({ data }) => `
  <h1>Composition pages</h1>
  <div id="slides">
    ${data.slides.map(slide => `<article data-compose="${slide.compose}">${slide.html}</article>`).join('\n')}
  </div>
  <aside id="explicit-preview">${data.slidePreview}</aside>
  <ul id="page-compositions">
    ${data.pageCompositions.map(page => `<li data-source="${page.source}" data-compose="${page.compose}">${page.source}</li>`).join('\n')}
  </ul>
`
