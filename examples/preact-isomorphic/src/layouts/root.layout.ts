import { html } from 'htm/preact';
import { render } from 'preact-render-to-string';
import type { VNode } from 'preact';

/**
 * Page variables that can be passed to the layout
 */
export interface PageVars {
  title?: string;
  siteName?: string;
  defaultStyle?: boolean;
  basePath?: string;
}

/**
 * Props for layout functions
 */
export interface LayoutProps<T> {
  vars: T;
  scripts?: string[];
  styles?: string[];
  children: string | VNode;
  pages?: unknown[];
  page?: unknown;
}

/**
 * Type definition for layout functions
 */
export type LayoutFunction<T> = (props: LayoutProps<T>) => string;

/**
 * Build all of the bundles using esbuild.
 */
export default function defaultRootLayout({
  vars: {
    title,
    siteName = 'Domstack',
    basePath,
    /* defaultStyle = true  Set this to false in global or page to disable the default style in the default layout */
  },
  scripts,
  styles,
  children,
  /* pages */
  /* page */
}: LayoutProps<PageVars>): string {
  return /* html */`
    <!DOCTYPE html>
    <html>
      ${render(html`
        <head>
          <meta charset="utf-8" />
          <title>${title ? `${title}` : ''}${title && siteName ? ' | ' : ''}${siteName}</title>
          <meta name="viewport" content="width=device-width, user-scalable=no" />
          <meta name="color-scheme" content="light dark" />
          ${scripts
            ? scripts.map(script => html`<script type='module' src="${script.startsWith('/') ? `${basePath ?? ''}${script}` : script}" />`)
            : null}
          ${styles
            ? styles.map(style => html`<link rel="stylesheet" href="${style.startsWith('/') ? `${basePath ?? ''}${style}` : style}" />`)
            : null}
        </head>
      `)}
      ${render(html`
        <body class="safe-area-inset">
        ${typeof children === 'string'
            ? html`<main class="mine-layout app-main" dangerouslySetInnerHTML=${{ __html: children }} />`
            : html`<main class="mine-layout app-main">${children}</main>`
        }
        </body>
      `)}
    </html>
  `;
}
