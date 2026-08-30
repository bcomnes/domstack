import { html, render } from 'fragtml'
import type { LayoutFunction } from '@domstack/static/types.js'
import type { RootVars } from './root.layout.js'

type RedirectVars = RootVars & {
  redirectTo: string
}

const redirectLayout: LayoutFunction<RedirectVars, string, string> = ({ vars }) => {
  return render(html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex" />
  <meta http-equiv="refresh" content="0;url=${vars.redirectTo}" />
  <link rel="canonical" href="${vars.redirectTo}" />
  <title>${vars.title}</title>
</head>
<body>
  <p>Redirecting to <a href="${vars.redirectTo}">${vars.redirectTo}</a></p>
</body>
</html>`)
}

export default redirectLayout
