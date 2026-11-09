import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL('../dist/web', import.meta.url)), emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4710', changeOrigin: true },
      '/files': { target: 'http://localhost:4710', changeOrigin: true },
      '/print': { target: 'http://localhost:4710', changeOrigin: true },
    },
  },
})
