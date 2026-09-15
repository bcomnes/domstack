import type {
  AsyncGlobalDataFunction,
  GlobalDataFunction,
  GlobalDataFunctionParams,
  GlobalDataChanges,
  GlobalDataDeltaChanges,
  GlobalDataResetChanges,
  PageData,
  WatchEvent,
} from '../../types.ts'
import type { BuildPagesOptions, PageBuilderReport } from './index.js'
import type { GlobalDataBaseline, GlobalDataInputChanges } from './global-data-state.js'

type Vars = { title: string }
type Data = { titles: string[] }
type State = { titles: Map<string, string> }

export function checkGlobalDataStateTypes (pages: PageData<Vars, string, any, any>[], events: WatchEvent[]) {
  const reset: GlobalDataResetChanges = { kind: 'reset', reason: 'initial', events }
  const delta: GlobalDataDeltaChanges<Vars, string> = { kind: 'delta', upserted: pages, removed: ['/removed.md'], events }
  const changes: GlobalDataChanges<Vars, string> = delta
  const params: GlobalDataFunctionParams<Vars, string, State> = {
    pages,
    previousState: undefined,
    changes,
    setState (next) { next.titles.set('/page.md', 'Title') },
  }
  const stateful: GlobalDataFunction<Data, Vars, string, State> = ({ pages, changes, previousState, setState }) => {
    const titles = previousState?.titles ?? new Map<string, string>()
    if (changes.kind === 'reset') {
      const reason: string = changes.reason
      titles.set(reason, pages[0]?.vars.title ?? '')
      // @ts-expect-error Reset changes do not contain a partial upsert list.
      String(changes.upserted)
    } else {
      changes.upserted.forEach(page => titles.set(page.pageInfo.pageFile.filepath, page.vars.title))
      changes.removed.forEach(path => titles.delete(path))
      // @ts-expect-error Delta changes do not have a reset reason.
      String(changes.reason)
    }
    setState({ titles })
    // @ts-expect-error State generic constrains updates independently of returned data.
    setState({ titles: ['wrong'] })
    return { titles: [...titles.values()] }
  }
  const asyncStateful: AsyncGlobalDataFunction<Data, Vars, string, State> = async context => stateful(context)
  // Existing generic positions and pages-only callback implementations remain valid.
  const legacy: GlobalDataFunction<Data, Vars, string> = ({ pages }) => ({ titles: pages.map(page => page.vars.title) })
  const asyncLegacy: AsyncGlobalDataFunction<Data, Vars, string> = async ({ pages }) => ({ titles: pages.map(page => page.vars.title) })
  const defaultState: GlobalDataFunction = ({ previousState, setState }) => {
    const state: unknown = previousState
    // @ts-expect-error Default state is unknown until narrowed or explicitly parameterized.
    setState(previousState.titles)
    setState(state)
    return {}
  }
  const baseline: GlobalDataBaseline = { state: { titles: new Map() }, sourcePaths: [] }
  const input: GlobalDataInputChanges = { resetReason: undefined, upsertedPaths: [], events }
  const options: BuildPagesOptions = { previousGlobalDataBaseline: baseline, globalDataInputChanges: input }
  const absent: BuildPagesOptions = { previousGlobalDataBaseline: null, globalDataInputChanges: undefined }
  const report: PageBuilderReport = { pages: [], templates: [], globalDataBaseline: baseline }
  return { reset, delta, params, stateful, asyncStateful, legacy, asyncLegacy, defaultState, options, absent, report }
}
