import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'gui',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/gui',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:7810',
    },
  },
})
