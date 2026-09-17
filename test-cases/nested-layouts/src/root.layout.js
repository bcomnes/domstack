/** @import { AsyncLayoutFunction } from '#types' */
import { label } from './label.js'
export const vars = { inherited: 'root', overridden: 'root', title: 'root' }
/** @type {AsyncLayoutFunction<{ inherited: string, overridden: string, title: string }, string, string>} */
export default async function ({ children, vars, styles = [], scripts = [] }) {
  return '<html><head>' + styles.map(s => '<link href="' + s + '">').join('') +
    scripts.map(s => '<script src="' + s + '"></script>').join('') +
    '</head><body data-root="' + label + '" data-vars="' +
    [vars.inherited, vars.overridden, vars.title].join(':') + '">' + children + '</body></html>'
}
