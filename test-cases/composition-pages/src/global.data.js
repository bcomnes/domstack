/**
 * @import { AsyncGlobalDataFunction } from '#types'
 *
 * @typedef {{ title?: string, slide?: number }} SourceVars
 * @typedef {{ title: string, compose: boolean, html: string }} Slide
 * @typedef {{ source: string, compose: boolean }} PageComposition
 * @typedef {{ slides: Slide[], slidePreview: string, pageCompositions: PageComposition[] }} CompositionData
 */

/** @type {AsyncGlobalDataFunction<CompositionData, SourceVars, string>} */
export default async ({ pages }) => {
  const slides = pages.filter(page => page.pageInfo.compose)
    .sort((a, b) => (a.vars.slide ?? 0) - (b.vars.slide ?? 0))
  const firstSlide = slides[0]
  if (!firstSlide) throw new Error('Expected composition slides')

  return {
    slides: await Promise.all(slides.map(async page => ({
      title: page.vars.title ?? '',
      compose: page.pageInfo.compose,
      html: await page.renderInnerPage(),
    }))),
    slidePreview: await firstSlide.renderFullPage(),
    pageCompositions: pages.map(page => ({
      source: page.pageInfo.pageFile.relname,
      compose: page.pageInfo.compose,
    })).sort((a, b) => a.source.localeCompare(b.source)),
  }
}
