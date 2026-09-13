import type { LayoutFunction, LayoutRequiredVars } from '#types'

type reqEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false

type reqEquivalent<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left] ? true : false
  : false

type reqExpect<Value extends true> = Value

type reqUnion = { a: string } | { b: number }
type reqTagged = { kind: 'a', a: string } | { kind: 'b', b: number }

declare module '#types' {
  interface LayoutRegistry {
    reqCompleteUnion: {
      render: LayoutFunction<reqUnion, string, string>
      vars: reqUnion
    }
    reqSharedMissing: {
      render: LayoutFunction<reqUnion & { shared: boolean }, string, string>
      vars: reqUnion
    }
    reqEmptyBranch: {
      render: LayoutFunction<{ x: string }, string, string>
      vars: {} | { x: string }
    }
    reqDifferentBranches: {
      render: LayoutFunction<reqTagged, string, string>
      vars: { kind: 'a' } | { kind: 'b' }
    }
    reqRendererAlternatives: {
      render: LayoutFunction<reqUnion, string, string>
    }
    reqIncompatibleBranch: {
      render: LayoutFunction<reqTagged, string, string>
      vars: { kind: 'a', a: string } | { kind: 'c' }
    }
    reqOptionalExport: {
      render: LayoutFunction<{ x: string }, string, string>
      vars?: { x: string }
    }
    reqUndefinedExport: {
      render: LayoutFunction<{ x: string }, string, string>
      vars: { x: string } | undefined
    }
    reqOptionalProperty: {
      render: LayoutFunction<{ x: string }, string, string>
      vars: { x?: string }
    }
    reqConflictingObligations: {
      render: LayoutFunction<{ kind: 'a', x: string } | { kind: 'b', x: number }, string, string>
      vars: { kind: 'a' } | { kind: 'b' }
    }
    reqChoicesPerBranch: {
      render: LayoutFunction<
        | { kind: 'a', a: string }
        | { kind: 'a', c: boolean }
        | { kind: 'b', b: number }
        | { kind: 'b', d: Date },
        string,
        string
      >
      vars: { kind: 'a' } | { kind: 'b' }
    }
    reqMetadata: {
      render: LayoutFunction<{ x: string }, string, string>
      vars: { dataDeps: ['navigation'] }
    }
  }
}

export type reqComplete = reqExpect<reqEqual<LayoutRequiredVars<'reqCompleteUnion'>, {}>>
export type reqShared = reqExpect<reqEqual<LayoutRequiredVars<'reqSharedMissing'>, { shared: boolean }>>
export type reqEmpty = reqExpect<reqEqual<LayoutRequiredVars<'reqEmptyBranch'>, { x: string }>>
export type reqDifferent = reqExpect<reqEqual<LayoutRequiredVars<'reqDifferentBranches'>, { a: string, b: number }>>
export type reqAlternatives = reqExpect<reqEqual<LayoutRequiredVars<'reqRendererAlternatives'>, reqUnion>>
export type reqIncompatible = reqExpect<reqEqual<LayoutRequiredVars<'reqIncompatibleBranch'>, never>>
export type reqOptional = reqExpect<reqEqual<LayoutRequiredVars<'reqOptionalExport'>, { x: string }>>
export type reqUndefined = reqExpect<reqEqual<LayoutRequiredVars<'reqUndefinedExport'>, { x: string }>>
export type reqOptionalKey = reqExpect<reqEqual<LayoutRequiredVars<'reqOptionalProperty'>, { x: string }>>
export type reqConflicting = reqExpect<reqEqual<LayoutRequiredVars<'reqConflictingObligations'>, never>>
export type reqNoMetadata = reqExpect<reqEqual<LayoutRequiredVars<'reqMetadata'>, { x: string }>>
export type reqChoices = reqExpect<reqEquivalent<
  LayoutRequiredVars<'reqChoicesPerBranch'>,
  ({ a: string } | { c: boolean }) & ({ b: number } | { d: Date })
>>

export const reqCompleteDefaultsNeedNothing: LayoutRequiredVars<'reqCompleteUnion'> = {}
// @ts-expect-error Every defaults branch must be covered, not just the 'a' branch.
export const reqMissingB: LayoutRequiredVars<'reqDifferentBranches'> = { a: 'supplied' }
// @ts-expect-error Every defaults branch must be covered, not just the 'b' branch.
export const reqMissingA: LayoutRequiredVars<'reqDifferentBranches'> = { b: 1 }
// @ts-expect-error The empty defaults branch still requires x.
export const reqMissingX: LayoutRequiredVars<'reqEmptyBranch'> = {}

export const reqChoiceAB: LayoutRequiredVars<'reqChoicesPerBranch'> = { a: 'supplied', b: 1 }
export const reqChoiceCD: LayoutRequiredVars<'reqChoicesPerBranch'> = { c: true, d: new Date() }
// @ts-expect-error Satisfying both choices for one defaults branch is not enough.
export const reqOnlyFirstBranch: LayoutRequiredVars<'reqChoicesPerBranch'> = { a: 'supplied', c: true }
