/**
 * @import { AsyncPageFunction } from '../../../../lib/build-pages/outputs/page-writer.js'
 */

/**
 * Worker test page
 * @type {AsyncPageFunction<{title: string}>}
 */
export default async function workerTestPage ({ vars }) {
  return `
    <div class="worker-test">
      <h1>${vars.title}</h1>
      <p>This page demonstrates dedicated and shared web worker integration.</p>

      <div class="worker-component">
        <h2>Dedicated worker</h2>
        <div class="counter-display">
          <p>Counter: <span id="counter">0</span></p>
        </div>
        <div class="controls">
          <button id="increment">Increment</button>
          <button id="reset">Reset</button>
        </div>
      </div>

      <div class="worker-component">
        <h2>Shared worker</h2>
        <div class="counter-display">
          <p>Shared counter: <span id="shared-counter">Connecting…</span></p>
        </div>
        <div class="controls">
          <button id="shared-increment">Increment shared counter</button>
          <button id="shared-reset">Reset shared counter</button>
        </div>
      </div>
    </div>
  `
}

export const vars = {
  title: 'Worker Test',
  layout: 'root'
}
