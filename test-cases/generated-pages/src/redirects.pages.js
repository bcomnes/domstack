const redirects = [
  { from: 'old-url', to: '/new-url/' },
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
