/**
 * Generate PNG icons (enabled + disabled) from master SVGs.
 * Run: node scripts/generate-icons.mjs
 */

import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const iconsDir = resolve(root, 'assets/icons')
const distDir = resolve(root, 'dist')

mkdirSync(iconsDir, { recursive: true })

const SIZES = [16, 32, 48, 128]
const VARIANTS = [
  { svgFile: 'icon.svg',          suffix: '' },
  { svgFile: 'icon-disabled.svg', suffix: '-disabled' },
]

function render(svgPath, size) {
  const svg = readFileSync(svgPath, 'utf-8')
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } })
  return resvg.render().asPng()
}

for (const { svgFile, suffix } of VARIANTS) {
  const svgPath = resolve(iconsDir, svgFile)
  if (!existsSync(svgPath)) { console.warn(`  ⚠  ${svgFile} not found, skipping`); continue }

  console.log(`\nGenerating from ${svgFile}`)
  for (const size of SIZES) {
    const png = render(svgPath, size)
    const name = `icon${size}${suffix}.png`

    writeFileSync(resolve(iconsDir, name), png)
    console.log(`  ✓ assets/icons/${name}`)

    if (existsSync(distDir)) {
      writeFileSync(resolve(distDir, name), png)
      console.log(`  ✓ dist/${name}`)
    }
  }
}

console.log('\nDone.')
