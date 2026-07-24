// Build script for electron main + preload
import { build } from 'vite'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const shared = {
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      external: [
        'electron',
        'node-pty',
        '@xterm/headless',
        'fs',
        'path',
        'child_process',
        'os',
        'url',
        'module',
        'events',
        'stream',
        'util',
        'buffer',
        'crypto',
        'node:crypto',
        /\.node$/,
      ],
    },
  },
}

await build({
  ...shared,
  configFile: false,
  build: {
    ...shared.build,
    lib: {
      entry: path.resolve(__dirname, 'electron/main.ts'),
      formats: ['es'],
      fileName: () => 'main.js',
    },
  },
})

await build({
  ...shared,
  configFile: false,
  build: {
    ...shared.build,
    lib: {
      entry: path.resolve(__dirname, 'electron/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      ...shared.build.rollupOptions,
    },
  },
})

// Preload для окна уведомлений — отдельная точка входа со своим API
await build({
  ...shared,
  configFile: false,
  build: {
    ...shared.build,
    lib: {
      entry: path.resolve(__dirname, 'electron/preload-notification.ts'),
      formats: ['cjs'],
      fileName: () => 'preload-notification.js',
    },
    rollupOptions: {
      ...shared.build.rollupOptions,
    },
  },
})

// HTML окна уведомлений — статика, просто копируем рядом с бандлами
fs.copyFileSync(
  path.resolve(__dirname, 'electron/notification.html'),
  path.resolve(__dirname, 'dist-electron/notification.html'),
)

console.log('Electron build done')
