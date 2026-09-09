/// <reference lib="dom" />

import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: true,
  // Keep explicit line breaks and parallel lanes instead of shrinking a wide
  // graph to fit the article. The page stylesheet provides horizontal scrolling.
  markdownAutoWrap: false,
  htmlLabels: false,
  flowchart: {
    useMaxWidth: false,
    curve: 'linear',
    nodeSpacing: 24,
    rankSpacing: 36,
    padding: 12,
    wrappingWidth: 320,
    subGraphTitleMargin: { top: 8, bottom: 16 },
  },
  themeVariables: {
    fontFamily: 'system-ui, sans-serif',
    lineColor: 'currentColor'
  }
})
