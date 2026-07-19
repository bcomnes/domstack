// Type-only public entry for `import type { ... } from '@domstack/static/types.js'`.
// There is intentionally no runtime `types.js` today; this source emits `types.d.ts`,
// and `types.js` is reserved for a future runtime/type companion entry if needed.
import type { Results } from './lib/builder.js'

export type { BuildOptions } from 'esbuild'
export type { DomStackOpts, Results, SiteData } from './lib/builder.js'
export type {
  AsyncGlobalDataFunction,
  GlobalDataFunction,
  GlobalDataFunctionParams,
} from './lib/build-pages/index.js'
export type {
  AsyncLayoutFunction,
  AsyncLayoutVarsFunction,
  LayoutFunction,
  LayoutFunctionParams,
  LayoutVars,
  LayoutVarsFunction,
  PageData,
} from './lib/build-pages/page-data.js'
export type {
  AsyncPageFunction,
  PageFunction,
  PageFunctionParams,
} from './lib/build-pages/page-builders/page-writer.js'
export type {
  TemplateAsyncIterator,
  TemplateFunction,
  TemplateFunctionParams,
  TemplateOutputOverride,
} from './lib/build-pages/page-builders/template-builder.js'
export type { PageInfo, ServiceWorkerInfo, TemplateInfo } from './lib/identify-pages.js'
export type {
  DomstackManifest,
  DomstackManifestEntry,
  DomstackManifestEntryPageMeta,
  DomstackManifestBuiltHook,
  DomstackManifestBuiltHookContext,
  DomstackManifestHooks,
  DomstackManifestKind,
  DomstackManifestOptions,
  DomstackManifestPolicyTransform,
  DomstackManifestPolicyTransformContext,
  DomstackManifestRecord,
  DomstackManifestTransform,
  DomstackManifestTransformContext,
} from './lib/domstack-manifest/index.js'

export type TestBuildResult = {
  dest: string
  results: Results
  readOutput: (path: string) => Promise<string>
  cleanup: () => Promise<void>
}
