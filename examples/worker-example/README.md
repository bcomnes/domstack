# DOMStack Web Workers Example

This example demonstrates how to use web workers in a DOMStack project.

## Overview

Web workers provide a way to run JavaScript in background threads, allowing for resource-intensive operations without blocking the main thread.
In this example, we demonstrate:

1. A dedicated counter worker that maintains state for one page
2. A shared counter worker that synchronizes state across same-origin tabs
3. A dedicated Fibonacci worker that performs computationally intensive operations

## Installation & Running

```bash
# Navigate to the example directory
cd examples/worker-example

# Install dependencies
npm install

# Build and serve
npm start
```

This will start a development server and open the example in your browser.

## How It Works

DOMStack supports web workers through a simple naming convention:

- Create files with the pattern `{name}.worker.js` in your page directories
- During build, DOMStack generates a `workers.json` file with worker filename mappings
- Access dedicated and shared workers in your client code using this metadata

## Implementation Details

### 1. Worker Files

The example includes three web worker files:

- `counter.worker.ts` - A dedicated worker that maintains a counter state and supports multiple operations
- `shared-counter.worker.ts` - A shared worker that synchronizes a counter across tabs
- `fibonacci.worker.js` - A dedicated worker that performs CPU-intensive Fibonacci calculations

### 2. Using Workers in Pages

Worker code is separated into page-scoped files and client-side code in `client.js`.
DOMStack generates a `workers.json` file with hashed worker paths:

```js
// Fetch workers.json to get the hashed worker filenames
async function initializeWorkers() {
  const response = await fetch('./workers.json');
  const workers = await response.json();

  const counterWorker = new Worker(
    new URL(`./${workers.counter}`, import.meta.url),
    { type: 'module' }
  );
  const sharedCounterWorker = new SharedWorker(
    new URL(`./${workers['shared-counter']}`, import.meta.url),
    { type: 'module' }
  );

  counterWorker.postMessage({ action: 'increment' });
  sharedCounterWorker.port.start();
  sharedCounterWorker.port.postMessage({ action: 'increment' });
}
```

## What You'll Learn

- How to create web worker files in DOMStack
- How web workers are automatically bundled by the build system
- How to use the `workers.json` file to access worker paths
- How dedicated workers communicate directly and shared workers communicate through `MessagePort`
- Practical patterns for worker communication
- Keeping the UI responsive during heavy computations

## Project Structure

```
worker-example/
├── package.json        # Project dependencies and scripts
├── src/
│   ├── globals/        # Global styles and variables
│   ├── layouts/        # Page layouts
│   ├── README.md       # Home page content
│   └── worker-page/    # Web worker example page
│       ├── page.js           # Main page template
│       ├── client.js         # Client-side code for worker interaction
│       ├── counter.worker.ts # Dedicated counter worker implementation
│       ├── shared-counter.worker.ts # Shared counter worker implementation
│       ├── fibonacci.worker.js # Fibonacci calculator worker
│       └── style.css         # Page-specific styles
```

## Build Output

When you build the project, DOMStack:

1. Bundles each worker file with a unique hash in the filename
2. Creates a `workers.json` file in each page directory that contains workers
3. Maps the original worker names to their hashed filenames

```
public/worker-page/
├── index.html
├── client-XXXX.js
├── counter.worker-XXXX.js        # Hashed dedicated worker filename
├── fibonacci.worker-XXXX.js      # Hashed dedicated worker filename
├── shared-counter.worker-XXXX.js # Hashed shared worker filename
├── workers.json                  # Contains worker path mappings
└── style-XXXX.css
```

## Benefits of Web Workers

- **Performance** - Run CPU-intensive tasks without blocking the UI
- **Responsiveness** - Keep your app responsive during heavy computations
- **Isolation** - Workers run in a separate context with their own memory
- **Shared state** - Shared workers coordinate same-origin tabs through one worker instance

## Learn More

- [MDN Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [Using Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
- [SharedWorker](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker)