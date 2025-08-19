/**
 * @import { AsyncPageFunction } from '../../../../lib/build-pages/page-builders/page-writer.js'
 */

/**
 * Worker test page
 * @type {AsyncPageFunction<{title: string}>}
 */
export default async function workerTestPage ({ vars }) {
  return `
    <div class="worker-test">
      <h1>${vars.title}</h1>
      <p>This page demonstrates web worker integration.</p>

      <div class="worker-component">
        <div class="counter-display">
          <p>Counter: <span id="counter">0</span></p>
        </div>
        <div class="controls">
          <button id="increment">Increment</button>
          <button id="reset">Reset</button>
        </div>
      </div>
    </div>
  `
}

export const vars = {
  title: 'Worker Test',
  layout: 'root'
}
