import type { PageFunction } from '@domstack/static/types.js'
import { renderSlide } from './components/slide.ts'
import type { SiteData } from './components/slide.ts'

export const vars = {
  title: 'A study in ordinary things',
  view: 'stack',
  dataDeps: ['slideStack'],
}

const homepage: PageFunction<typeof vars, string, Pick<SiteData, 'slideStack'>> = ({ data }) =>
  data.slideStack.map(slide => renderSlide(slide)).join('\n')

export default homepage
