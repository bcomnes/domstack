declare module '@11ty/dependency-tree' {
  export function clearCache (filePath?: string): void
  export function find (filePath: string): Promise<string[]>
  export function findGraph (filePath: string): Promise<object>
  export function mergeGraphs (...graphs: object[]): object
}
