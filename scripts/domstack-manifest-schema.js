import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  DOMSTACK_MANIFEST_SCHEMA_PATH,
  domstackManifestSchema,
} from '../lib/domstack-manifest/index.js'

// Keep the checked-in schema.json generated from the JS schema source so the
// published $schema URL, runtime manifest shape, and exported types stay aligned.
const outputPath = resolve(import.meta.dirname, '..', DOMSTACK_MANIFEST_SCHEMA_PATH)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(domstackManifestSchema, null, 2)}\n`)
