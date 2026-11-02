// Writes every drawing in icons.mjs to its SVG file next to this script.
// Run after editing icons.mjs: `node design/app-icon/export.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ICONS } from './icons.mjs'

const here = dirname(fileURLToPath(import.meta.url))

for (const [path, draw] of Object.entries(ICONS)) {
  const out = join(here, path)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, draw())
  console.log(out)
}
