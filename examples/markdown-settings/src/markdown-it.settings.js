/**
 * Custom Markdown-it Configuration
 *
 * This file demonstrates how to extend DOMStack's markdown rendering
 * capabilities by customizing the markdown-it instance.
 *
 * Key features demonstrated:
 * 1. Adding custom container plugins (warning, info, details)
 * 2. Customizing code block rendering
 * 3. Applying custom CSS classes for styling
 */

/**
 * @import MarkdownIt from 'markdown-it'
 */
import markdownItContainer from 'markdown-it-container'

/**
 * Creates a custom container plugin configuration
 *
 * @param {string} name - Container name ('warning', 'info', etc.)
 * @param {string} defaultTitle - Default title if none specified
 * @param {string} cssClass - CSS class for the container
 * @returns {Object} - Container plugin configuration
 */
function createContainer (name, defaultTitle, cssClass) {
  return {
    validate: function (params) {
      return params.trim().match(new RegExp(`^${name}\\s*(.*)$`))
    },
    render: function (tokens, idx, options, env, self) {
      const m = tokens[idx].info.trim().match(new RegExp(`^${name}\\s*(.*)$`))
      if (tokens[idx].nesting === 1) {
        // Opening tag
        const title = (m && m.length > 1) ? m[1] : defaultTitle
        return `<div class="${cssClass}">\n<div class="${name}-title">` +
               title +
               `</div>\n<div class="${name}-content">\n`
      } else {
        // Closing tag
        return '</div>\n</div>\n'
      }
    }
  }
}

/**
 * Customize the markdown-it instance with additional plugins and renderers
 *
 * @param {MarkdownIt} md - The markdown-it instance
 * @returns {MarkdownIt} - The modified markdown-it instance
 */
export default async function markdownItSettingsOverride (md) {
  // =====================================================
  // CUSTOM CONTAINERS
  // =====================================================

  // Add warning container: ::: warning Title
  md.use(
    markdownItContainer,
    'warning',
    createContainer('warning', 'Warning', 'custom-warning')
  )

  // Add info container: ::: info Title
  md.use(
    markdownItContainer,
    'info',
    createContainer('info', 'Info', 'custom-info')
  )

  // Add details/collapsible container: ::: details Title
  // Add custom container for collapsible sections
  md.use(markdownItContainer, 'details', {
    validate: function (params) {
      return params.trim().match(/^details\s+(.*)$/)
    },
    render: function (tokens, idx) {
      const m = tokens[idx].info.trim().match(/^details\s+(.*)$/)
      if (tokens[idx].nesting === 1) {
        return '<details>\n<summary>' + m[1] + '</summary>\n<div class="details-content">\n'
      } else {
        return '</div>\n</details>\n'
      }
    }
  })

  // =====================================================
  // CUSTOM RENDERERS
  // =====================================================

  // Customize code block rendering with enhanced styling
  // Customize existing renderer - add custom classes to code blocks
  md.renderer.rules.code_block = function (tokens, idx, options, env, renderer) {
    const token = tokens[idx]
    const content = token.content
    const langName = token.info || ''

    return `<pre class="custom-code-block"><code class="language-${langName}">${renderer.utils.escapeHtml(content)}</code></pre>\n`
  }

  // You can add more customizations here:
  // - Custom link renderers
  // - Table formatting
  // - Image processing
  // - Etc.

  return md
}
