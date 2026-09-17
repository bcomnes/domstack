declare module 'markdown-it-sub' {
  import type { MarkdownIt } from 'markdown-it'

  export default function subscript (md: MarkdownIt): void
}

declare module 'markdown-it-sup' {
  import type { MarkdownIt } from 'markdown-it'

  export default function superscript (md: MarkdownIt): void
}

declare module 'markdown-it-deflist' {
  import type { MarkdownIt } from 'markdown-it'

  export default function definitionList (md: MarkdownIt): void
}

declare module 'markdown-it-ins' {
  import type { MarkdownIt } from 'markdown-it'

  export default function insertedText (md: MarkdownIt): void
}

declare module 'markdown-it-mark' {
  import type { MarkdownIt } from 'markdown-it'

  export default function markedText (md: MarkdownIt): void
}

declare module 'markdown-it-abbr' {
  import type { MarkdownIt } from 'markdown-it'

  export default function abbreviation (md: MarkdownIt): void
}

declare module 'markdown-it-task-lists' {
  import type { MarkdownIt } from 'markdown-it'

  function taskLists (md: MarkdownIt, options?: taskLists.Options): void

  namespace taskLists {
    interface Options {
      enabled?: boolean
      label?: boolean
      labelAfter?: boolean
    }
  }

  export = taskLists
}

declare module 'markdown-it-table-of-contents' {
  import type { MarkdownIt, Token } from 'markdown-it'

  export interface Options {
    includeLevel?: number[]
    containerClass?: string
    slugify?: (text: string, token: Token) => string
    markerPattern?: RegExp
    omitTag?: string
    listType?: 'ul' | 'ol'
    format?: (content: string, md: MarkdownIt, anchor: string | null) => string
    containerHeaderHtml?: string
    containerFooterHtml?: string
    transformLink?: (anchor: string | null) => string | null
    transformContainerOpen?: (containerClass: string, containerHeaderHtml: string | undefined) => string
    transformContainerClose?: (containerFooterHtml: string | undefined) => string
    getTokensText?: (tokens: Token[], token: Token) => string
  }

  export default function tableOfContents (md: MarkdownIt, options?: Options): void
}

// The package's entry point assigns the function to module.exports, but its
// bundled declaration describes a default property on that CommonJS export.
declare module 'markdown-it-highlightjs' {
  import type { MarkdownIt } from 'markdown-it'
  import type { HighlightOptions } from 'markdown-it-highlightjs/types/core.js'

  function highlightjs (md: MarkdownIt, options?: HighlightOptions): void

  namespace highlightjs {
    const defaults: Required<Pick<HighlightOptions, 'auto' | 'code' | 'inline' | 'ignoreIllegals'>>
  }

  export = highlightjs
}
