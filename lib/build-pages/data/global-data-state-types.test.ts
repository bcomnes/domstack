import type { AsyncGlobalDataFunction, GlobalDataFunction } from '../../../types.ts'

type Vars = { title: string }
type Data = { titles: string[] }
type State = { titles: Map<string, string> }

export const stateful: GlobalDataFunction<Data, Vars, string, State> = ({ pages, changes, previousState, setState }) => {
  const titles = previousState?.titles ?? new Map<string, string>()
  if (changes.kind === 'reset') {
    const reason: string = changes.reason
    titles.set(reason, pages[0]?.vars.title ?? '')
    // @ts-expect-error Reset changes do not contain a partial upsert list.
    String(changes.upserted)
  } else {
    for (const page of changes.upserted) {
      titles.set(page.sourceId, page.vars.title)
      // @ts-expect-error Source IDs are read-only.
      page.sourceId = 'other.md'
    }
    changes.removed.forEach(sourceId => titles.delete(sourceId))
    // @ts-expect-error Delta changes do not have a reset reason.
    String(changes.reason)
  }
  setState({ titles })
  // @ts-expect-error State is constrained independently of returned data.
  setState({ titles: ['wrong'] })
  return { titles: [...titles.values()] }
}

export const asyncStateful: AsyncGlobalDataFunction<Data, Vars, string, State> = async context => stateful(context)

export const pagesOnly: GlobalDataFunction<Data, Vars, string> = ({ pages }) => ({ titles: pages.map(page => page.vars.title) })

export const unknownState: GlobalDataFunction = ({ previousState, setState }) => {
  // @ts-expect-error Default state is unknown until narrowed or parameterized.
  setState(previousState.titles)
  setState(previousState)
  return {}
}
