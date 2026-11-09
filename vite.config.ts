import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // CSP только в сборке: dev-сервер Vite вставляет свои inline-скрипты.
      // Скрипты — только файлы самого приложения, без inline и onerror=:
      // если в окно попадёт чужой HTML, он не выполнится
      name: 'vael-csp',
      apply: 'build',
      transformIndexHtml: html => html.replace('<head>',
        `<head>
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'; base-uri 'none'">`),
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
})
