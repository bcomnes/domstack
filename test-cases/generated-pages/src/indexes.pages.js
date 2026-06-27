// @ts-nocheck

export default function indexesPages ({ pages }) {
  const posts = pages.filter(page => page.vars.publishDate && page.pageInfo.path.startsWith('blog/'))

  return {
    outputName: 'blog/2024/index.html',
    vars: {
      layout: 'root',
      title: '2024 posts',
      postCount: posts.length,
    },
    children: ({ vars }) => `<h1>${vars.title}</h1><p id="post-count">${vars.postCount}</p>`,
  }
}
