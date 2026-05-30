// Build script for electron main + preload
import { build } from 'vite'
import path from 'path'
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
        'fs',
        'path',
        'child_process',
        'os',
        'url',
        'events',
        'stream',
        'util',
        'buffer',
        'crypto',
        'node:crypto',
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

console.log('Electron build done')
