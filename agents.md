# Agent Guidelines

- Write Markdown prose with one sentence per line so git diffs stay focused and readable.
- Never use inline type imports.
- Always favor `@import` syntax at the top of JavaScript files for JSDoc types.
- This repo does not require TypeScript declaration builds during normal development.
- Type builds are only needed during publish time or when debugging types.
- After running a type build, clean up the generated build files and do not leave them sitting around.
- Use the cleanup scripts in `package.json` for generated type build files.
- When handling PR review comments, validate that each comment is correct before making changes; maintainer comments are almost always valid, but review bot comments may be wrong, and after addressing a comment, always reply with what was done.
