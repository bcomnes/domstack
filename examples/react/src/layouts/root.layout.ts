import { html } from 'htm/react'
import { renderToStaticMarkup } from 'react-dom/server'

// Define TypeScript interfaces for layout props
interface LayoutVars {
  title?: string;
  siteName?: string;
  basePath?: string;
}

interface LayoutProps {
  vars: LayoutVars;
  scripts?: string[];
  styles?: string[];
  children: string | any;
}

/**
 * Basic layout for React with TypeScript example
 *
 * This layout is only used for the initial HTML page structure.
 * React components will be mounted client-side after the page loads.
 * Uses React DOM Server for server-side rendering.
 */
export default function rootLayout ({
  vars: {
    title,
    siteName = 'React TypeScript Example',
    basePath,
  },
  scripts,
  styles,
  children,
}: LayoutProps): string {
  return /* html */`
    <!DOCTYPE html>
    <html>
      ${renderToStaticMarkup(html`
        <head>
          <meta charSet="utf-8" />
          <title>${`${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}`}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="description" content="React with TypeScript and DOMStack example" />
          ${scripts
            ? scripts.map(script => html`<script type='module' src="${script.startsWith('/') ? `${basePath ?? ''}${script}` : script}" />`)
            : null}
          ${styles
            ? styles.map(style => html`<link rel="stylesheet" href="${style.startsWith('/') ? `${basePath ?? ''}${style}` : style}" />`)
            : null}
        </head>
      `)}
      ${renderToStaticMarkup(html`
        <body>
          ${typeof children === 'string'
            ? html`<main className="mine-layout" dangerouslySetInnerHTML="${{ __html: children }}"/>`
            : html`<main className="mine-layout">${children}</main>`
          }
        </body>
      `)}
    </html>
  `
}
