import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, existsSync } from 'fs'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-extension-assets',
      closeBundle() {
        // Copy interceptor to dist root (referenced by manifest content_scripts)
        if (existsSync('src/injected/interceptor.js')) {
          copyFileSync('src/injected/interceptor.js', 'dist/interceptor.js')
        }
        // Copy manifest to dist
        if (existsSync('manifest.json')) {
          copyFileSync('manifest.json', 'dist/manifest.json')
        }
        // Copy icons
        const iconSizes = ['16', '32', '48', '128']
        for (const size of iconSizes) {
          const src = `assets/icons/icon${size}.png`
          if (existsSync(src)) {
            copyFileSync(src, `dist/icon${size}.png`)
          }
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        'content-script': resolve(__dirname, 'src/content/content-script.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (['background', 'content-script'].includes(chunk.name)) {
            return '[name].js'
          }
          return 'assets/[name]-[hash].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
