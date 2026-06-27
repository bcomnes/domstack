/**
 * @import { PageFunction } from '@domstack/static/types.js'
 * @import { PageVars } from '../layouts/root.layout.js
 */
import { html } from 'htm/preact'

/**
* @type { PageFunction <PageVars> }
*/
export default async function JSPage ({
  vars: {
    siteName,
    title,
  }
}) {
  return html`
  <div class="js-page-example">
    <h1>JavaScript Page Example</h1>

    <section class="explanation">
      <h2>What is a JavaScript Page?</h2>
      <p>
        The JavaScript page type is the most powerful and flexible option in DOMStack.
        It allows you to:
      </p>
      <ul>
        <li>Access and use variables directly in your rendering logic</li>
        <li>Generate dynamic content based on data or conditions</li>
        <li>Use component-based architecture with Preact or other libraries</li>
        <li>Return either HTML strings or component objects</li>
      </ul>
    </section>

    <section class="implementation">
      <h2>How to Implement</h2>
      <p>
        Export a default function (async or sync) that returns a string or any
        type that your layout can handle. In this example, we're using
        <a href="https://github.com/developit/htm"><code>htm/preact</code></a> for JSX-like syntax.
      </p>
      <div class="code-example">
        <pre><code>export default async function MyPage({ vars }) {
  return html\`<div>Content here</div>\`
}</code></pre>
      </div>
    </section>

    <section class="variables-demo">
      <h2>Using Variables</h2>
      <p>Here we access the <code>siteName</code> and <code>title</code> variables inside the page:</p>
      <div class="variable-display">
        <div><strong>Site Name:</strong> ${siteName}</div>
        <div><strong>Page Title:</strong> ${title}</div>
      </div>
    </section>

    <section class="additional-features">
      <h2>Additional Features</h2>
      <p>JavaScript pages support:</p>
      <ul>
        <li>Page-scoped <code>client.js</code> for browser interactions</li>
        <li>Page-scoped <code>style.css</code> for component styling</li>
        <li>Page-specific variables via <code>export const vars</code></li>
        <li>Async data fetching before rendering</li>
      </ul>
    </section>

    <a href="../" class="back-link">← Back to Home</a>
  </div>
  `
}

// Define page-specific variables
export const vars = {
  title: 'JavaScript Page Example',
  description: 'Learn how to use JavaScript pages in DOMStack for dynamic content generation'
}
