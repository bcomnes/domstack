export function illustrationFile (design: string, night = false): string {
  const extension = design.startsWith('folio-') ? 'webp' : 'jpg'
  return `domstack-${design}${night ? '-night' : ''}-og.${extension}`
}
