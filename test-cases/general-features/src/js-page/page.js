import { PAGE_STAMP } from '../libs/page-helper.js'

export default async () => {
  return /* html */`<div>
    This is jus some html ${PAGE_STAMP}
  </div>`
}

export const vars = {
  somePageScopled: 'vars',
}
