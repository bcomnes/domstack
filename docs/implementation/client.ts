import mermaid from 'mermaid'

// Keep diagram statements semicolon-terminated: nested layout rendering can
// normalize the newlines in their HTML before Mermaid reads them.
mermaid.initialize({
  startOnLoad: true,
  themeVariables: {
    lineColor: 'currentColor'
  }
})
