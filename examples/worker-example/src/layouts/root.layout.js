/**
 * Root layout for the worker example
 *
 * This layout file determines the outer HTML structure of all pages.
 * It receives variables, children content, scripts, and styles from the pages.
 */
export default function rootLayout ({
  vars: {
    siteName,
    title,
    description,
  },
  children,
  scripts = [],
  styles = [],
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark" />
  <meta name="description" content="${description || 'DOMStack Web Workers Example'}">
  <title>${title ? `${title} | ${siteName}` : siteName}</title>
  ${styles.map(style => `<link rel="stylesheet" href="${style}">`).join('\n  ')}
</head>
<body>
  <div class="mine-layout">
    <header>
      <div class="navigation">
        <a href="/">Home</a>
        <a href="/worker-page/">Web Worker Example</a>
      </div>
    </header>
    
    <main>
      ${children}
    </main>
    
    <footer class="footer">
      <p>DOMStack Web Workers Example &copy; ${new Date().getFullYear()}</p>
    </footer>
  </div>
  
  ${scripts.map(script => `<script type="module" src="${script}"></script>`).join('\n  ')}
</body>
</html>`
}
