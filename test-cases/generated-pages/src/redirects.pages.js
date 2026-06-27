const redirects = [
  { from: 'old-url', to: '/new-url/' },
  { from: 'docs/old-guide', to: '/guides/current/' },
  { from: 'company', to: '/about/' },
]

export default function redirectsPages () {
  return redirects.map(({ from, to }) => ({
    outputName: `${from}/index.html`,
    vars: {
      layout: 'redirect',
      title: 'Redirecting...',
      redirectTo: to,
    },
    children: '',
  }))
}
