import { html, raw, render } from 'fragtml'

export type SlideMeta = {
  id: string
  order: number
  label: string
  theme: 'paper' | 'ink' | 'green'
  kind: 'hero' | 'statement' | 'editorial' | 'gallery' | 'closing' | 'motion' | 'contact' | 'typography'
  background?: string
  backgroundMode?: 'sticky' | 'fixed'
  video?: { src: string; poster: string }
  includeInStack?: boolean
}

export type SlideVars = { title: string; slide: SlideMeta }
export type SlideRecord = SlideMeta & { title: string; url: string; content: string }
export type NavigationItem = Pick<SlideRecord, 'id' | 'label' | 'url'>
export type SiteData = { slideStack: SlideRecord[]; slideNavigation: NavigationItem[] }

export function renderSlide (slide: SlideRecord, standalone = false): string {
  return render(html`
    <section id="${slide.id}" class="slide slide--${slide.kind}" data-theme="${slide.theme}" data-background-mode="${slide.background && !slide.video ? slide.backgroundMode ?? 'sticky' : 'sticky'}" aria-label="${slide.title}" tabindex="-1">
      ${slide.video || slide.background
? html`
        <div class="slide-backdrop" aria-hidden="true">
          <div class="backdrop-image"><img src="${slide.video?.poster ?? slide.background}" alt="" loading="${standalone || slide.order === 1 ? 'eager' : 'lazy'}" fetchpriority="${standalone || slide.order === 1 ? 'high' : 'auto'}" decoding="async" /></div>
                    ${slide.video ? html`<video id="${slide.id}-video" class="backdrop-video" data-background-video data-src="${slide.video.src}" poster="${slide.video.poster}" muted loop playsinline preload="none" tabindex="-1"></video>` : null}
          <div class="backdrop-shade"></div>
        </div>
      `
: null}
      ${slide.video ? html`<div class="video-controls"><button class="video-toggle" type="button" data-video-toggle aria-controls="${slide.id}-video" aria-label="Play background video" title="Play background video" hidden><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><path data-video-icon d="m8 5 11 7-11 7Z" /></svg></button></div>` : null}
      <div class="slide-content">
      <div class="slide-meta">
        <span class="slide-number">${String(slide.order).padStart(2, '0')}</span>
        <span class="slide-label">${slide.label}</span>
        ${standalone ? html`<a class="slide-permalink" href="/#${slide.id}">View in sequence ↗</a>` : null}
      </div>
      ${standalone && !/<h1[\s>]/i.test(slide.content) ? html`<h1 class="sr-only">${slide.title}</h1>` : null}
      <div class="slide-body">${raw(slide.content)}</div>
      </div>
    </section>
  `)
}
