// Layouts can be as simple as returning a template literal.
// This example shows how to use pure string template literals
// without any additional templating library.

export default async function RootLayout ({
  vars: {
    title,
    siteName,
  },
  scripts,
  styles,
  children,
}) {
  return /* html */`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${siteName || ''}${title ? ` | ${title}` : ''}</title>
        <meta name="viewport" content="width=device-width, user-scalable=no" />
        <meta name="color-scheme" content="light dark" />
        ${scripts
          ? scripts.map(script => /* html */`<script src="${script}" type='module'></script>`).join('\n        ')
          : ''}
        ${styles
          ? styles.map(style => /* html */`<link rel="stylesheet" href="${style}" />`).join('\n        ')
          : ''}
      </head>
      <body>
        <div class="mine-layout">
          ${children}
        </div>
      </body>
    </html>
  `
}
