// @ts-nocheck

export default function rootLayout ({ vars, styles = [], scripts = [], children }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${vars.title}</title>
  ${styles.map(href => `<link rel="stylesheet" href="${href}">`).join('\n  ')}
  ${scripts.map(src => `<script type="module" src="${src}"></script>`).join('\n  ')}
  <meta name="generated-page-count" content="${vars.generatedPageCount ?? 0}">
</head>
<body>
  <main>${children}</main>
</body>
</html>`
}
