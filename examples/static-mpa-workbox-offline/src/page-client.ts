/// <reference lib="dom" />

export function markPageClientLoaded (pageName: string): void {
  const main = document.querySelector('main')
  if (!main) return

  const note = document.createElement('p')
  note.className = 'page-client-note'
  note.dataset.pageClient = pageName
  note.textContent = `Page client loaded: ${pageName}`
  main.append(note)
}
