import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/qr-cipher/',
  optimizeDeps: {
    include: ['argon2-browser'],
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        encrypt: resolve(__dirname, 'encrypt.html'),
        decrypt: resolve(__dirname, 'decrypt.html'),
      },
    },
  },
})
