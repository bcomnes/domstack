# Agent Guidelines

- In Markdown files in the DOMStack repository, write prose with one sentence per source line so git diffs stay focused and readable.
- In GitHub pull request descriptions, issues, comments, and review replies, write each prose paragraph on a single source line, with blank lines between paragraphs, because GitHub renders individual newlines as line breaks.
- Preserve the line breaks required by Markdown lists, code blocks, tables, and other structured content in both contexts.
- Never use inline type imports.
- Always favor `@import` syntax at the top of JavaScript files for JSDoc types.
- Add explicit TypeScript lib reference headers when a standalone example file relies on browser or service-worker globals, such as `/// <reference lib="dom" />` for client files or `/// <reference lib="webworker" />` for service-worker files.
- This repo does not require TypeScript declaration builds during normal development.
- Type builds are only needed during publish time or when debugging types.
- After running a type build, clean up the generated build files and do not leave them sitting around.
- Use the cleanup scripts in `package.json` for generated type build files.
- For formatting-only ESLint failures, use `npx eslint <path> --fix` for a quick targeted fix before rerunning lint.
- When handling PR review comments, validate that each comment is correct before making changes; maintainer comments are almost always valid, but review bot comments may be wrong, and after addressing a comment, always reply with what was done.
