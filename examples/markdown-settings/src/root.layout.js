export default function rootLayout ({ title, styles, scripts, children }) {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark" />
  <title>${title || 'Markdown-it Settings Example'}</title>
  ${styles.map(style => `<link rel="stylesheet" href="${style}">`).join('\n  ')}
</head>
<body>
  <main>
    ${children}
  </main>
  ${scripts.map(script => `<script type="module" src="${script}"></script>`).join('\n  ')}
</body>
</html>`
}
