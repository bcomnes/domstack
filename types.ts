/// <reference path="./types/thread-stream.d.ts" preserve="true" />

// Type-only public entry for `import type { ... } from '@domstack/static/types.js'`.
// There is intentionally no runtime `types.js` today; this source emits `types.d.ts`,
// and `types.js` is reserved for a future runtime/type companion entry if needed.
import type { Results } from './lib/builder.js'
import type {
  GeneratedPageDefinition as GeneratedPageDefinitionExport,
  PagesFunctionParams as PagesFunctionParamsExport,
} from './lib/build-pages/index.js'

import type { PageFunction as PageFunctionExport } from './lib/build-pages/outputs/page-writer.js'
import type { PageOutputsFunction as PageOutputsFunctionExport } from './lib/build-pages/outputs/page-outputs.js'

export type { DataDeps } from './lib/build-pages/global-data/data-deps.js'
export type {
  GlobalDataChanges,
  GlobalDataDeltaChanges,
  GlobalDataResetChanges,
} from './lib/build-pages/global-data/global-data-state.js'
export type { WatchEvent } from './lib/watch/plan.js'
export type {
  PageOutput,
  PageOutputProvenance,
  PageOutputsFunction,
  PageOutputsFunctionParams,
  PageOutputsPage,
  PageOutputsResult,
  CollectedPageOutput,
} from './lib/build-pages/outputs/page-outputs.js'

export type { BuildOptions } from 'esbuild'
export type { DomStackOpts, Results, SiteData } from './lib/builder.js'
export type {
  AsyncGlobalDataFunction,
  GeneratedPageDefinition,
  GlobalDataFunction,
  GlobalDataFunctionParams,
  PagesFunction,
  PagesFunctionParams,
} from './lib/build-pages/index.js'
export type {
  AsyncLayoutFunction,
  AsyncLayoutVarsFunction,
  LayoutFunction,
  LayoutFunctionParams,
  LayoutVars,
  LayoutVarsFunction,
} from './lib/build-pages/layouts/resolve-layout.js'
export type { PageData } from './lib/build-pages/page/page-data.js'
export type {
  AsyncPageFunction,
  PageFunction,
  PageFunctionParams,
} from './lib/build-pages/outputs/page-writer.js'
export type {
  AsyncTemplateFunction,
  TemplateAsyncIterator,
  TemplateFunction,
  TemplateFunctionParams,
  TemplateOutputOverride,
} from './lib/build-pages/templates/template-builder.js'
export type { PageInfo, PagesFileInfo, ServiceWorkerInfo, TemplateInfo } from './lib/identify-pages.js'
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

/**
 * Compile-time registry for layouts known to an application's TypeScript
 * program. Layout modules opt in through module augmentation; DOMStack does not
 * create or read this registry at runtime.
 *
 * Each property key is a layout's runtime name, with an entry describing its exports:
 * - `render`: Required renderer type, normally `typeof layoutRenderer`.
 *   Supplies the accepted vars and children types and the layout's return type.
 *   Keep the renderer explicitly typed rather than deriving it from its own entry.
 * - `vars`: Optional defaults export type, normally `typeof vars`.
 *   Object defaults or sync/async provider results are shallow-merged outer-to-inner,
 *   after global vars and before page overrides. `dataDeps` is not a renderer var.
 * - `parentLayout`: Optional single literal registered parent name, normally
 *   `typeof parentLayout`. Omit it for an outermost layout. Helpers check that
 *   this renderer's awaited output is accepted by the parent's children type.
 *
 * This interface intentionally has no index signature so unknown layout and
 * parent names can be detected. Registry helpers require strictNullChecks;
 * without it they resolve to never. Existing explicit renderer APIs are unchanged.
 */
export interface LayoutRegistry {}

/**
 * Additional-output hook using an existing page or layout renderer's vars and
 * own data subscriptions, with the restricted page-output metadata handle.
 * Generated pages do not run these hooks, including inherited layout hooks.
 */
export type PageOutputsForRenderer<Renderer> =
  Renderer extends (params: infer Params, ...rest: any[]) => any
    ? Params extends { vars: infer Vars extends AnyVars, data: infer Data extends object }
      ? PageOutputsFunctionExport<Vars, Data>
      : never
    : never

/** Names registered in the current TypeScript program. */
export type LayoutRegistryName = Extract<keyof LayoutRegistry, string>

/**
 * Registered layout names from the outermost layout to the selected innermost
 * layout. Invalid entries, missing parents, cycles, incompatible render values,
 * and chains deeper than 32 layouts resolve to `never`.
 */
export type LayoutChain<Name extends string> = ResolveLayoutChain<Name>

/** Layout defaults merged outermost to innermost, excluding dataDeps metadata. */
export type LayoutProvidedVars<Name extends string> =
  ResolveLayoutChain<Name> extends infer Chain
    ? [Chain] extends [never]
        ? never
        : Chain extends readonly [string, ...string[]]
          ? MergeLayoutDefaults<Chain>
          : never
    : never

/**
 * Renderer variables that are not definitely supplied by a registered layout's
 * `vars` export. They must be supplied by another source such as global vars,
 * page vars/frontmatter, or builder vars.
 */
export type LayoutRequiredVars<Name extends string> =
  ResolveLayoutChain<Name> extends infer Chain
    ? [Chain] extends [never]
        ? never
        : Chain extends readonly [string, ...string[]]
          ? RequiredVarsAcrossDefaults<MergeRendererVars<Chain>, MergeLayoutDefaults<Chain>>
          : never
    : never

/**
 * Variables visible to the page after known sources are shallow-merged in
 * runtime precedence order: global vars, outer-to-inner layout vars, then page
 * vars/frontmatter/builder vars. Renderer declarations provide the baseline
 * contract and every known override must remain compatible with every renderer
 * in the chain.
 */
export type LayoutChainVars<
  Name extends string,
  GlobalVars extends AnyVars = {},
  PageVars extends AnyVars = {}
> = ResolveLayoutChain<Name> extends infer Chain
  ? [Chain] extends [never]
      ? never
      : Chain extends readonly [string, ...string[]]
        ? CheckedLayoutVars<Chain, GlobalVars, PageVars>
        : never
  : never

/** The value a page must return for the selected innermost layout. */
export type LayoutPageOutput<Name extends string> =
  ResolveLayoutChain<Name> extends infer Chain
    ? [Chain] extends [never]
        ? never
        : Chain extends readonly [string, ...string[]]
          ? RendererChildren<Last<Chain>>
          : never
    : never

/**
 * Awaited result of the outermost layout. This is distinct from DOMStack's final
 * serialized HTML string.
 */
export type LayoutResult<Name extends string> =
  ResolveLayoutChain<Name> extends infer Chain
    ? [Chain] extends [never]
        ? never
        : Chain extends readonly [infer Outer extends string, ...string[]]
          ? RendererResult<Outer>
          : never
    : never

/**
 * Page render function inferred from a selected registered layout.
 *
 * `Data` is the page's own subscribed data contract. Layout data contracts are
 * intentionally not merged into it.
 */
export type PageForLayout<
  Name extends string,
  PageVars extends AnyVars = {},
  Data extends object = Record<string, unknown>,
  GlobalVars extends AnyVars = {}
> = ResolveLayoutChain<Name> extends infer Chain
  ? [Chain] extends [never]
      ? never
      : Chain extends readonly [string, ...string[]]
        ? CheckedLayoutVars<Chain, GlobalVars, PageVars> extends infer Vars
          ? [Vars] extends [never]
              ? never
              : Vars extends AnyVars
                ? PageFunctionExport<Vars, RendererChildren<Last<Chain>>, Data>
                : never
          : never
        : never
  : never

/**
 * Validate resolved page/frontmatter vars against a registered chain using only
 * actual known sources: global vars, layout defaults, then page vars. Returns
 * the original supplied PageVars on success, or never for missing requirements
 * or incompatible overrides. Unlike PageForLayout, renderer requirements do not
 * supply a baseline. Name identifies the chain to check, not runtime selection.
 * dataDeps stays in the export but is removed before checking renderer vars.
 */
export type ValidatePageVars<
  Name extends string,
  PageVars extends AnyVars,
  GlobalVars extends AnyVars = {}
> = [SuppliedLayoutVars<Name, GlobalVars, PageVars>] extends [never] ? never : PageVars

/**
 * One generated page for a registered layout. vars contains only supplied page
 * vars plus a required literal layout selector. Inline children receive the
 * validated final merged vars and their own Data, never the factory's data.
 * Empty content may be omitted only when the layout accepts an empty string.
 * Static null/undefined also normalize to empty content; functions are renderers.
 */
export type GeneratedPageForLayout<
  Name extends string,
  PageVars extends AnyVars = {},
  Data extends object = Record<string, unknown>,
  GlobalVars extends AnyVars = {}
> = SuppliedLayoutVars<Name, GlobalVars, PageVars & { layout: Name }> extends infer ResolvedVars
  ? [ResolvedVars] extends [never]
      ? never
      : [ResolvedVars] extends [AnyVars]
          ? GeneratedLayoutDefinition<Name, PageVars & { layout: Name }, Extract<ResolvedVars, AnyVars>, Data>
          : never
  : never

/**
 * A sync/async factory or async generator producing pages for one layout.
 * GlobalVars describes only effective globals available before layout defaults;
 * FactoryData and PageData are independent subscription contracts. Module
 * dataDeps subscribes the factory; each definition's vars.dataDeps subscribes
 * its inline renderer. Type arguments alone do not create subscriptions.
 */
export type PagesForLayout<
  Name extends string,
  PageVars extends AnyVars = {},
  GlobalVars extends AnyVars = {},
  FactoryData extends object = Record<string, unknown>,
  PageData extends object = Record<string, unknown>
> = GeneratedPageForLayout<Name, PageVars, PageData, GlobalVars> extends infer Definition
  ? [Definition] extends [never]
      ? never
      : (params: PagesFunctionParamsExport<GlobalVars, FactoryData>) =>
      GeneratedLayoutResults<Definition> | Promise<GeneratedLayoutResults<Definition>>
  : never

type GeneratedLayoutResults<Definition> =
  Definition | Definition[] | AsyncIterable<Definition> | null | undefined

type GeneratedLayoutDefinition<
  Name extends string,
  SuppliedVars,
  ResolvedVars extends AnyVars,
  Data extends object
> = Pick<GeneratedPageDefinitionExport, 'outputName' | 'draft'>
  & { vars: SuppliedVars }
  & GeneratedLayoutChildren<LayoutPageOutput<Name>, ResolvedVars, Data>

type AwaitCompatible<Children, Whole = Children> =
  Children extends unknown ? [Awaited<Children>] extends [Whole] ? Children : never : never

type GeneratedLayoutChildren<Children, Vars extends AnyVars, Data extends object> =
  [AwaitCompatible<Children>] extends [never]
    ? never
    : '' extends Children
      ? { children?: GeneratedLayoutContent<AwaitCompatible<Children>, Vars, Data> | null | undefined }
      : { children: GeneratedLayoutContent<AwaitCompatible<Children>, Vars, Data> }

// Callable objects can structurally match a plain object children contract but
// runtime calls them as renderers. Reserve callable/thenable members on static
// objects; an inline renderer can return objects with ordinary call/apply keys.
type StaticLayoutContent<Value> = Value extends object
  ? Value & { call?: never, apply?: never, bind?: never, then?: never }
  : Value

type RenderedLayoutContent<Value> = Value extends object ? Value & { then?: never } : Value

type GeneratedLayoutContent<Children, Vars extends AnyVars, Data extends object> =
  StaticLayoutContent<Exclude<Children, AnyFunction | PromiseLike<unknown> | null | undefined>>
  | PageFunctionExport<Vars, RenderedLayoutContent<Exclude<Children, PromiseLike<unknown>>>, Data>

type WithoutSubscriptions<Vars> = Vars extends unknown ? Omit<Vars, 'dataDeps'> : never

type SuppliedLayoutVars<
  Name extends string,
  GlobalVars extends AnyVars,
  PageVars extends AnyVars
> = ResolveLayoutChain<Name> extends infer Chain
  ? [Chain] extends [never]
      ? never
      : Chain extends readonly [string, ...string[]]
        ? 'dataDeps' extends KeysOfUnion<GlobalVars>
          ? never
          : MergeRight<
          MergeRight<GlobalVars, MergeLayoutDefaults<Chain>>,
          WithoutSubscriptions<PageVars>
        > extends infer Vars
            ? [Vars] extends [never]
                ? never
                : true extends HasNeverRequired<Vars>
                  ? never
                  : EveryRendererAccepts<Chain, Vars> extends true
                    ? Vars
                    : never
            : never
        : never
  : never

type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never

type AnyVars = Record<string, any>
type AnyFunction = (...args: any[]) => any

type RegistryEntry<Name extends string> =
  Name extends LayoutRegistryName ? LayoutRegistry[Name] : never

type EntryProperty<Entry, Key extends PropertyKey> =
  Key extends keyof Entry ? Entry[Key] : never

type Renderer<Name extends string> =
  RegistryEntry<Name> extends { readonly render: infer Render extends AnyFunction }
    ? Render
    : never

type RendererParams<Name extends string> =
  Renderer<Name> extends (params: infer Params, ...rest: any[]) => any
    ? Params
    : never

type RendererVars<Name extends string> =
  RendererParams<Name> extends { readonly vars: infer Vars extends AnyVars }
    ? Vars
    : never

type RendererChildren<Name extends string> =
  RendererParams<Name> extends { readonly children: infer Children }
    ? Children
    : never

type RendererResult<Name extends string> =
  Renderer<Name> extends AnyFunction ? Awaited<ReturnType<Renderer<Name>>> : never

type RendererIsValid<Name extends string> =
  [Renderer<Name>] extends [never]
    ? false
    : RendererParams<Name> extends {
      readonly vars: AnyVars
      readonly children: unknown
    }
      ? true
      : false

type ResolvedVarsValue<Value> =
  Value extends AnyVars ? Value : false

type ResolveVarsExport<Value> =
  Value extends undefined
    ? {}
    : Value extends () => infer Result
      ? ResolvedVarsValue<Awaited<Result>>
      : ResolvedVarsValue<Value>

type EntryDefaults<Name extends string> =
  'vars' extends keyof RegistryEntry<Name>
    ? ResolveVarsExport<EntryProperty<RegistryEntry<Name>, 'vars'>> extends infer Defaults
      ? [Defaults] extends [AnyVars]
          ? Defaults
          : never
      : never
    : {}

type RootReference = { readonly kind: 'root' }
type ParentReference<Name extends string> = { readonly kind: 'parent', readonly name: Name }
type InvalidParentReference = { readonly kind: 'invalid' }

type IsUnion<Value, Whole = Value> =
  Value extends unknown ? ([Whole] extends [Value] ? false : true) : never

type EntryParent<Name extends string> =
  'parentLayout' extends keyof RegistryEntry<Name>
    ? EntryProperty<RegistryEntry<Name>, 'parentLayout'> extends infer Parent
      ? [Parent] extends [never]
          ? InvalidParentReference
          : [Parent] extends [undefined]
              ? RootReference
              : undefined extends Parent
                ? InvalidParentReference
                : [Parent] extends [string]
                    ? string extends Parent
                      ? InvalidParentReference
                      : true extends IsUnion<Parent>
                        ? InvalidParentReference
                        : ParentReference<Parent & string>
                    : InvalidParentReference
      : InvalidParentReference
    : RootReference

type ResolveLayoutChain<
  Name extends string,
  Seen extends string = never,
  Depth extends readonly unknown[] = []
> = undefined extends string
  ? never
  : true extends IsUnion<Name>
    ? never
    : string extends Name
      ? never
      : ResolveLiteralLayoutChain<Name, Seen, Depth>

type ResolveLiteralLayoutChain<
  Name extends string,
  Seen extends string,
  Depth extends readonly unknown[]
> = Depth['length'] extends 32
  ? never
  : Name extends LayoutRegistryName
    ? Name extends Seen
      ? never
      : RendererIsValid<Name> extends true
        ? [EntryDefaults<Name>] extends [never]
            ? never
            : EntryParent<Name> extends RootReference
              ? readonly [Name]
              : EntryParent<Name> extends ParentReference<infer Parent>
                ? Parent extends LayoutRegistryName
                  ? [RendererResult<Name>] extends [RendererChildren<Parent>]
                      ? ResolveLayoutChain<
                      Parent,
                      Seen | Name,
                      readonly [...Depth, unknown]
                    > extends infer Parents
                        ? Parents extends readonly [string, ...string[]]
                          ? readonly [...Parents, Name]
                          : never
                        : never
                      : never
                  : never
                : never
        : never
    : never

type Simplify<Value> = { -readonly [Key in keyof Value]: Value[Key] }

type OptionalKeys<Value> = Exclude<keyof Value, RequiredKeys<Value>>

// Without exactOptionalPropertyTypes, an explicitly supplied undefined is a
// legal override and must remain in the result even when the left key exists.
type PresentProperty<Value, Key extends keyof Value> =
  { value: undefined } extends { value?: never } ? Value[Key] : Required<Value>[Key]

type SpreadPair<Left, Right> = Simplify<
  Omit<Left, keyof Right>
  & Pick<Right, RequiredKeys<Right>>
  & {
    [Key in Extract<OptionalKeys<Right>, RequiredKeys<Left>>]-?:
    Key extends keyof Left
      ? Left[Key] | PresentProperty<Right, Key & keyof Right>
      : PresentProperty<Right, Key & keyof Right>
  }
  & {
    [Key in Exclude<OptionalKeys<Right>, RequiredKeys<Left>>]?:
      (Key extends keyof Left ? Left[Key] : never)
      | PresentProperty<Right, Key & keyof Right>
  }
>

/** Distributive, right-biased shallow merge matching object spread semantics. */
type MergeRight<Left, Right> =
  Left extends object
    ? Right extends object
      ? SpreadPair<Left, Right>
      : never
    : never

/** Renderer declarations are simultaneous requirements, not override sources. */
type MergeRendererVars<
  Chain extends readonly string[],
  Accumulated = {}
> = Chain extends readonly [infer Current extends string, ...infer Rest extends string[]]
  ? MergeRendererVars<Rest, Accumulated & RendererVars<Current>>
  : RenderableRequirements<SatisfiableRequirements<Accumulated>>

// Subscription metadata is never a renderer variable. Drop optional metadata,
// but reject alternatives that require it rather than inventing a runtime value.
type RenderableRequirements<Requirements> = Requirements extends unknown
  ? WithoutSubscriptions<Requirements> extends Requirements
    ? WithoutSubscriptions<Requirements>
    : never
  : never

type MergeLayoutDefaults<
  Chain extends readonly string[],
  Accumulated = {}
> = Chain extends readonly [infer Current extends string, ...infer Rest extends string[]]
  ? MergeLayoutDefaults<Rest, MergeRight<Accumulated, WithoutSubscriptions<EntryDefaults<Current>>>>
  : Simplify<Accumulated>

type CandidateLayoutVars<
  Chain extends readonly string[],
  GlobalVars extends AnyVars,
  PageVars extends AnyVars
> = 'dataDeps' extends KeysOfUnion<GlobalVars>
  ? never
  : MergeRight<
    MergeRight<
      MergeRight<MergeRendererVars<Chain>, GlobalVars>,
      MergeLayoutDefaults<Chain>
    >,
    WithoutSubscriptions<PageVars>
  >

type EveryRendererAccepts<Chain extends readonly string[], Vars> =
  Chain extends readonly [infer Current extends string, ...infer Rest extends string[]]
    ? [Vars] extends [RendererVars<Current>]
        ? EveryRendererAccepts<Rest, Vars>
        : false
    : true

type NeverRequiredKeys<Value> = {
  [Key in RequiredKeys<Value>]: [Value[Key]] extends [never] ? Key : never
}[RequiredKeys<Value>]

// Intersections of union contracts can contain impossible alternatives; those
// are not valid requirements and should not invalidate the remaining choices.
type SatisfiableRequirements<Value> =
  Value extends unknown
    ? [NeverRequiredKeys<Value>] extends [never] ? Value : never
    : never

type HasNeverRequired<Value> =
  Value extends unknown
    ? [NeverRequiredKeys<Value>] extends [never] ? false : true
    : never

type CheckedLayoutVars<
  Chain extends readonly string[],
  GlobalVars extends AnyVars,
  PageVars extends AnyVars
> = CandidateLayoutVars<Chain, GlobalVars, PageVars> extends infer Vars
  ? [Vars] extends [never]
      ? never
      : true extends HasNeverRequired<Vars>
        ? never
        : EveryRendererAccepts<Chain, Vars> extends true
          ? Simplify<Vars>
          : never
  : never

// Each defaults branch can choose any compatible renderer alternative (OR).
// Drop stronger alternatives when a weaker obligation already covers them.
type MinimalRequiredVars<Choices, Whole = Choices> =
  Choices extends unknown
    ? Choices extends Exclude<Whole, Choices> ? never : Choices
    : never

type RequiredVarsForDefault<Requirements, Defaults> =
  Requirements extends unknown
    ? [MergeRight<Requirements, Defaults>] extends [Requirements]
        ? Pick<Requirements, Exclude<RequiredKeys<Requirements>, RequiredKeys<Defaults>>>
        : never
    : never

// Wrap before distributing so {} cannot absorb another branch's obligations,
// and never cannot silently disappear. Contravariant inference combines the
// branch obligations with AND without intersecting their renderer choices.
type RequiredVarsDefaultFunctions<Requirements, Defaults> =
  Defaults extends unknown
    ? (vars: MinimalRequiredVars<RequiredVarsForDefault<Requirements, Defaults>>) => void
    : never

type RequiredVarsAcrossDefaults<Requirements, Defaults> =
  RequiredVarsDefaultFunctions<Requirements, Defaults> extends (vars: infer Vars) => void
    ? Simplify<SatisfiableRequirements<Vars>>
    : never

type RequiredKeys<Value> = {
  [Key in keyof Value]-?: {} extends Pick<Value, Key> ? never : Key
}[keyof Value]

type Last<Values extends readonly string[]> =
  Values extends readonly [...string[], infer Value extends string] ? Value : never
