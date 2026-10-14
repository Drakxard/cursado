import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { offlineApp } from './scripts/pwa-build.ts'

// https://vite.dev/config/
export default defineConfig({
  base: '/pizarra/',
  plugins: [react(),offlineApp()],
  server: { proxy: { '/pizarra/api': { target: process.env.PIZARRA_BACKEND_URL || 'http://127.0.0.1:8765', changeOrigin: true, rewrite: path => path.replace(/^\/pizarra/, '') }, '/pizarra/recognize': { target: process.env.PIZARRA_BACKEND_URL || 'http://127.0.0.1:8765', changeOrigin: true, rewrite: path => path.replace(/^\/pizarra/, '') } } },
})
