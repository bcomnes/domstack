import type { LayoutFunction } from '@domstack/static/types.js'
import { renderSlide } from '../components/slide.ts'
import type { SlideVars } from '../components/slide.ts'

export const parentLayout = 'root'
export const vars = { view: 'slide' }

const slideLayout: LayoutFunction<SlideVars, string, string> = ({ children, vars, page }) =>
  renderSlide({ ...vars.slide, title: vars.title, url: page.url, content: children }, true)

export default slideLayout
