// Rebuild the shipped icons without changing the chosen drawing or alternatives.
// Run on macOS: `mise exec -- pnpm icons` (requires `brew install resvg`).
// Tauri generates the cross-platform files in a staging directory; only the
// existing desktop file set is copied out, so mobile assets never enter the repo.
import { accessSync, constants, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ICONS } from './icons.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const resvg = '/opt/homebrew/bin/resvg'
const desktopFiles = [
  '32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.ico', 'icon.icns',
  'Square30x30Logo.png', 'Square44x44Logo.png', 'Square71x71Logo.png',
  'Square89x89Logo.png', 'Square107x107Logo.png', 'Square142x142Logo.png',
  'Square150x150Logo.png', 'Square284x284Logo.png', 'Square310x310Logo.png',
  'StoreLogo.png',
]

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (status ${result.status}, signal ${result.signal})`)
}

function render(svg, size, output) {
  run(resvg, ['--width', String(size), '--height', String(size), svg, output])
}

function build(stage) {
  const mainSvg = join(stage, 'mdnotate.svg')
  const smallSvg = join(stage, 'mdnotate-small.svg')
  writeFileSync(mainSvg, ICONS['mdnotate.svg']())
  writeFileSync(smallSvg, ICONS['mdnotate-small.svg']())
  const source = join(stage, 'source.png')
  render(mainSvg, 1024, source)
  const desktop = join(stage, 'desktop')
  run('pnpm', ['exec', 'tauri', 'icon', source, '-o', desktop])

  // The 16@2x and 32 slots both contain 32 pixels, but both must use the
  // optical variant. The 32@2x slot starts the full drawing at 64 pixels.
  const iconset = join(stage, 'mdnotate.iconset')
  mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale
      const svg = pixels <= 32 ? smallSvg : mainSvg
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`
      render(svg, pixels, join(iconset, name))
    }
  }
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(desktop, 'icon.icns')])
  render(smallSvg, 32, join(desktop, '32x32.png'))

  // Publish only once every generator has succeeded. Keep the source SVG and
  // favicon byte-identical; neither is an independently maintained drawing.
  for (const name of desktopFiles) copyFileSync(join(desktop, name), join(root, 'src-tauri/icons', name))
  copyFileSync(mainSvg, join(here, 'mdnotate.svg'))
  copyFileSync(smallSvg, join(here, 'mdnotate-small.svg'))
  copyFileSync(mainSvg, join(root, 'public/favicon.svg'))
}

function main() {
  accessSync(resvg, constants.X_OK)
  mkdirSync(join(root, 'tmp'), { recursive: true })
  const stage = mkdtempSync(join(root, 'tmp/app-icons-'))
  try {
    build(stage)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  console.log('Generated desktop icons, SVG drawings and public/favicon.svg.')
}

try {
  main()
} catch (error) {
  console.error(`Icon generation failed: ${error.message}\nRequires macOS iconutil, pnpm and ${resvg} (brew install resvg).`)
  process.exitCode = 1
}
