import assert from 'node:assert/strict'
import { stripVTControlCharacters } from 'node:util'
import test from 'node:test'
import { domstackBanner } from './banner.js'
import { domstackBanner as publicBanner } from '../../index.js'
import { formatCliHelp } from './help.js'

test('exports an unstyled shared DOMStack banner', () => {
  assert.equal(publicBanner, domstackBanner)
  assert.equal(domstackBanner, stripVTControlCharacters(domstackBanner))
  assert.equal(domstackBanner.split('\n').length, 12)
})

for (const command of /** @type {const} */ ([null, 'build', 'watch', 'serve', 'eject'])) {
  test(`includes the shared banner in ${command ?? 'root'} help`, async () => {
    const help = stripVTControlCharacters(await formatCliHelp(command, '1.2.3'))
    assert.ok(help.startsWith(`${domstackBanner}\n\n`))
    assert.equal(help.split(domstackBanner).length, 2)
    assert.ok(help.includes(command ? `Usage: domstack ${command} [options]` : 'Usage: domstack [command] [options]'))
    assert.ok(help.includes('domstack (v1.2.3)'))
    if (command === 'eject') {
      assert.ok(help.includes('js (JavaScript) or ts (TypeScript)'))
      assert.ok(help.includes('mine (default, mine.css and syntax themes)'))
      assert.ok(help.includes('tailwind (Tailwind CSS and esbuild plugin)'))
      assert.ok(help.includes('none (no global styles)'))
      assert.ok(help.includes('none (no integration), preact, or react'))
      assert.ok(!help.includes('--tailwind'))
    }
  })
}
