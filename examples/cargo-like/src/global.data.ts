import type { GlobalDataFunction } from '@domstack/static/types.js'
import type { SiteData, SlideRecord, SlideVars } from './components/slide.ts'

const collectSlides: GlobalDataFunction<SiteData> = async ({ pages }) => {
  const ids = new Set<string>()
  const slides: SlideRecord[] = []
  for (const page of pages) {
    if (!page.pageInfo.path.startsWith('slides/')) continue
    const { title, slide } = page.vars as unknown as SlideVars
    if (!slide) continue
    if (!/^[a-z][a-z0-9-]*$/.test(slide.id) || ids.has(slide.id)) {
      throw new Error(`Slide IDs must be unique lowercase slugs: ${slide.id}`)
    }
    if (!Number.isFinite(slide.order)) throw new Error(`Slide ${slide.id} needs a numeric order`)
    ids.add(slide.id)
    if (slide.includeInStack === false) continue
    // Render only the source body: its layout subscribes to navigation after this phase.
    const content = await page.renderInnerPage()
    if (typeof content !== 'string') throw new Error(`Slide ${slide.id} must render an HTML string`)
    slides.push({ ...slide, title, url: page.pageInfo.url, content })
  }
  slides.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return {
    slideStack: slides,
    slideNavigation: slides.map(({ id, label, url }) => ({ id, label, url })),
  }
}

export default collectSlides
