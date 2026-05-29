/**
 * Generate PNG icons from the master SVG at each required Chrome extension size.
 * Uses @resvg/resvg-js (Rust-based, high-quality, works offline on all platforms).
 *
 * Run: node scripts/generate-icons.mjs
 */

import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const SVG_PATH = resolve(root, 'assets/icons/icon.svg')
const SIZES = [16, 32, 48, 128]

const svg = readFileSync(SVG_PATH, 'utf-8')

// Ensure output directories exist
const iconsDir = resolve(root, 'assets/icons')
mkdirSync(iconsDir, { recursive: true })

console.log('Generating PNG icons from', SVG_PATH)

for (const size of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  })

  const rendered = resvg.render()
  const png = rendered.asPng()

  const destIcons = resolve(iconsDir, `icon${size}.png`)
  writeFileSync(destIcons, png)
  console.log(`  ✓ assets/icons/icon${size}.png  (${size}×${size})`)

  // Also write to dist/ if it already exists (post-build convenience)
  const distDir = resolve(root, 'dist')
  if (existsSync(distDir)) {
    const destDist = resolve(distDir, `icon${size}.png`)
    writeFileSync(destDist, png)
    console.log(`  ✓ dist/icon${size}.png  (${size}×${size})`)
  }
}

console.log('Done.')
