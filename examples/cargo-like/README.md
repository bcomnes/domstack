# Cargo / Like

A Cargo Collective-inspired DOMStack website exploring immersive typography, imagery, and interaction.
DOMStack's low-overhead abstractions make it an ideal tool for implementing complex, highly designed websites: layouts, content composition, and asset bundling provide structure without getting between you and HTML, CSS, or browser APIs.

Eight chapters form one continuous scrolling page: Opening, Motion, Interval, Study, Composition, Collection, Contact, and Colophon.
Oversized typography and interactive compositions scroll over pinned architectural images and video.
Each chapter also has a standalone page for development and preview.
Assets are local, scrolling uses native anchors, and essential content remains readable without JavaScript.

## Run

From the DOMStack repository root:

```sh
git lfs install --local
git lfs pull
npm install
npm --workspace @domstack/cargo-like-example run dev
```

The example uses the local DOMStack workspace.
Use `npm run example:cargo-like` to build, or the example's `typecheck` and `test` scripts to validate it.
Browser tests require Playwright Chromium (`npx playwright install chromium`).
Build output goes to `public/` inside the example; test screenshots go to its ignored `artifacts/` directory.
Media uses Git LFS, so deployment and CI checkouts must fetch LFS objects too.

## Deploy to Neocities

Add the target site's API key as the repository Actions secret `NEOCITIES_CARGO_LIKE_API_TOKEN`.
**Deploy Cargo / Like to Neocities** runs on pushes to `master` and can also be started manually from GitHub Actions (`.github/workflows/neocities-cargo-like.yml`).
The workflow fetches LFS assets, builds this example, and uploads `examples/cargo-like/public` without deleting existing remote files.
The bundled MP4 requires a Neocities Supporter account.

## How slides work

Each `src/slides/<slug>/page.md` contains metadata and a Markdown/HTML composition.
DOMStack builds it at `/slides/<slug>/`, while the homepage embeds its inner content at `/#<id>`.
Standalone previews use the same section renderer and include a “View in sequence” link.

| File | Responsibility |
| --- | --- |
| `src/global.data.ts` | Collects slide pages, validates IDs and ordering, renders inner content, and exports `slideStack` and `slideNavigation`. |
| `src/page.ts` | Subscribes to `slideStack` and renders the homepage sequence. |
| `src/components/slide.ts` | Defines the slide types and shared `renderSlide()` wrapper. |
| `src/layouts/slide.layout.ts` | Renders an individual slide. |
| `src/layouts/root.layout.ts` | Supplies the document shell and subscribes to `slideNavigation` for chapter links. |
| `src/globals/global.client.ts` | Initializes progressive browser interactions for both views. |

Slides are sorted by numeric `order`, then alphabetically by ID for ties.
The section number displays `order`; navigation numbering reflects sequence position.
Slide content must not subscribe to the global data being computed during its rendering.
Layouts may subscribe to navigation because collection renders only the inner content.

### Internal data API

Types are exported from `src/components/slide.ts`:

- `SlideMeta`: the `slide` frontmatter fields documented below.
- `SlideVars`: `{ title: string; slide: SlideMeta }`.
- `SlideRecord`: `SlideMeta` plus `title`, the page `url`, and rendered HTML `content`.
- `NavigationItem`: a record's `id`, `label`, and `url`.
- `SiteData`: `{ slideStack: SlideRecord[]; slideNavigation: NavigationItem[] }`.
- `renderSlide(slide: SlideRecord, standalone = false): string`: renders the section, backdrop, metadata, and authored body.
  Standalone mode adds the return link and a visually hidden `h1` if the content has none.

## Add a slide

Create `src/slides/<slug>/page.md`:

```yaml
---
title: Chapter title
layout: slide
slide:
  id: chapter-slug
  order: 9
  label: Chapter label
  theme: paper
  kind: editorial
  background: /slides/study/curves.jpg
---
```

Write Markdown or HTML below the frontmatter, using an existing slide as a composition example.

| `slide` field | Contract |
| --- | --- |
| `id` | Unique lowercase slug matching `^[a-z][a-z0-9-]*$`; also the homepage anchor. |
| `order` | Finite number controlling sequence and displayed section number. |
| `label` | Short label for section metadata and navigation. |
| `theme` | `paper` (warm/muted), `ink` (monochrome), or `green` (desaturated). |
| `kind` | `hero`, `statement`, `editorial`, `gallery`, `closing`, `motion`, `typography`, or `contact`; selects styles, not a content template. |
| `background` | Optional decorative image URL; omit for a plain section. |
| `backgroundMode` | `sticky` (default) or `fixed`; fixed images remain viewport-anchored during entry and exit, clipped to the section. |
| `video` | Optional `{ src, poster }`; both URLs are required, and video takes precedence over `background`. |
| `includeInStack` | Set to `false` to retain the standalone page but omit it from the homepage and navigation. |

Use root-relative asset URLs such as `/slides/<slug>/image.jpg`.
The example assumes deployment at a domain root.

### Styles and assets

Create a `style.css` beside the new page, importing `../../page.css` before its composition rules.
Add an explicit import for that stylesheet to `src/style.css` so the homepage includes it too.

- `src/globals/global.css`: fonts, tokens, base styles, focus utilities, and reduced-motion defaults.
- `src/page.css`: shared page shell, navigation, backdrops, text utilities, and interaction styles.
- `src/slides/<slug>/style.css`: the slide's layout and responsive rules; also its standalone stylesheet entry point.
- `src/style.css`: homepage entry point importing the shared styles and every slide stylesheet.

Embedding inner content does not automatically include its page-local styles or client scripts.
Shared browser behavior belongs in the global client bundle.
Keep media beside its owning slide and reuse its URL rather than duplicating files.

## Browser interaction API

Modules in `src/globals/client/` export initializer functions without registering listeners on import.
The global entry point waits for the DOM, guards against duplicate initialization, and initializes them with shared reduced-motion handling.
No extra script tags are needed.

| Module | Authoring hook / behavior |
| --- | --- |
| `navigation.ts` | Chapter anchors and mobile menu; tracks the active slide without hijacking scrolling. |
| `fit-text.ts` | `data-fit-text` on an unwrapped text line inside a width-constrained parent. |
| `drag.ts` | `data-drag` on a button inside a bounded container; supports pointer dragging, arrow keys, and Home. |
| `pointer-rotate.ts` | `data-pointer-rotate` on a decorative child for pointer-following rotation. |
| `reveal.ts` | `data-reveal` for optional entrances, not essential headings or content. |
| `scroll-progress.ts` | Updates the shared scroll progress indicator. |
| `lightbox.ts` | `initializeLightbox()` enhances `.photo-grid` image links as described below. |
| `background-video.ts` | Enhances renderer-generated video and playback controls. |
| `contact-form.ts` | Validates and previews a message locally using the form hooks below. |

Reduced motion disables animated scrolling, pointer-following rotation, reveal transitions, and gallery transitions.
Backdrop pinning is CSS-only; fixed backgrounds fall back to sticky treatment without `clip-path` support.

### Video

```yaml
slide:
  # Other slide metadata as above.
  video:
    src: /slides/motion/flower.mp4
    poster: /slides/motion/flower-poster.jpg
```

Video works with any `kind` and always uses the sticky backdrop treatment.
The renderer supplies `video[data-background-video]` with `data-src`, plus a `[data-video-toggle]` button linked through `aria-controls` and a `[data-video-icon]` child.
The client loads video only when playback is allowed and the slide is visible; playback is muted, looping, and inline.
It pauses offscreen or in hidden tabs and remembers manual pauses.
Reduced motion, data saving, and disabled JavaScript retain the poster without automatic video downloads.
With JavaScript, users can explicitly start playback; autoplay rejection leaves the play control available, while media errors retain the poster and disable playback.

### Galleries

Use real image links so galleries work without JavaScript:

```html
<div class="photo-grid">
  <a class="photo-card" data-lightbox href="/slides/study/curves.jpg"
     data-pswp-width="1600" data-pswp-height="1200"
     data-pswp-cropped="true" data-caption="01 / Lorem">
    <img src="/slides/study/curves.jpg" alt="Curved architectural facade" loading="lazy">
    <span>01 / Lorem</span>
  </a>
</div>
```

Replace the example dimensions with the linked full-size image's natural pixel dimensions, not its thumbnail or display size.
Set `data-pswp-cropped="true"` when thumbnails use `object-fit: cover`, as these cards do, so PhotoSwipe aligns its zoom animation with the visible crop.
Each `.photo-grid` is a separate PhotoSwipe gallery.
`data-caption` supplies the caption, falling back to the image's `alt`; both are treated as plain text.
The locally bundled viewer supports zoom, arrow-key navigation, Escape to close, and focus restoration to the originating link.

### Contact preview

Contact is a local preview demo: it does not send requests, navigate, or persist entered data.
Use `kind: contact` and copy `src/slides/contact/page.md`, preserving these contracts:

- `form[data-contact-form]` uses `method="dialog"` as a non-navigation fallback.
- `fieldset[data-contact-fields]` starts `disabled` in source HTML; initialization enables it.
- Labeled fields are named `name`, `email`, `subject`, and `message`.
  Name, valid email, and a trimmed message of at least ten characters are required; subject is optional.
- Error IDs follow `contact-<field>-error` and are connected with `aria-describedby`.
  Validation updates `aria-invalid` and focuses the first invalid field.
- Keep the “Preview message” submit button, “Start over” reset button, and `[data-contact-status]` live region.
- `[data-contact-preview]` starts hidden and contains `[data-preview-name]`, `[data-preview-email]`, `[data-preview-subject]`, and `[data-preview-message]`.
  Values are inserted as text; editing hides the preview, and reset clears fields, errors, and status.

### Composition typography

The Composition slide demonstrates CSS-positioned glyphs rather than JavaScript text placement.
Its local styling hooks are `.type-poster` / `.type-title` / `.type-letters` / `.type-serif` for the first arrangement, `.type-score` / `.type-line` for the second, and `.type-note`, `.type-orbit`, and `.type-next` for supporting content.
Keep complete accessible heading text in `.sr-only` and mark duplicate decorative glyphs `aria-hidden="true"`.
Use `data-reveal` only on supporting notes and `data-pointer-rotate` only on decorative elements.

## Asset notices

Inter and Fraunces are SIL OFL fonts; licenses and source URLs live in `src/fonts/`.
DS Weiss-Gotisch has a separate, non-OFL license restricting modification and distribution; review `src/fonts/DSWeiss-Gotisch-LICENSE.txt` before publishing it.
Architectural photos come from Unsplash; review permissions before redistribution.
The sample flower video is CC0, with provenance in `src/slides/motion/SOURCES.txt`.
