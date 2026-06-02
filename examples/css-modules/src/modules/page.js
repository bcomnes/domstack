import { html } from 'fragtml'
// import styles from './app.module.css' THIS DOESN'T WORK IN NODE.JS

export default () => {
  return html`
      <div class="container">
        <h1>CSS Modules Example</h1>

        <section>
          <h2>Module-Scoped CSS</h2>
          <p>This example demonstrates how CSS Modules work in DOMStack.</p>

          <div>
            <p>This div uses the <code>outerShell</code> class from app.module.css</p>
            <p>The class name is scoped to this component only.</p>
          </div>

          <pre><code>
// How to import and use CSS modules:
import styles from './app.module.css'

// Then use them in your components:
&lt;div class=\${styles.outerShell}&gt;
  Scoped CSS!
&lt;/div&gt;
          </code></pre>
        </section>

        <section>
          <h2>Benefits of CSS Modules</h2>
          <ul>
            <li>No CSS class name collisions</li>
            <li>Localized styling to components</li>
            <li>Explicit dependencies</li>
            <li>Composition support</li>
          </ul>
        </section>
      </div>
    `
}

export const vars = {
  title: 'CSS Modules Example',
  description: 'Learn how to use CSS Modules for component-scoped styling in DOMStack'
}
