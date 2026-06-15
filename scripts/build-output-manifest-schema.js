import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  BUILD_OUTPUT_MANIFEST_SCHEMA_PATH,
  buildOutputManifestSchema,
} from '../lib/build-output-manifest/index.js'

// Keep the checked-in schema.json generated from the JS schema source so the
// published $schema URL, runtime manifest shape, and exported types stay aligned.
const outputPath = resolve(import.meta.dirname, '..', BUILD_OUTPUT_MANIFEST_SCHEMA_PATH)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(buildOutputManifestSchema, null, 2)}\n`)
