import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    include: ['argon2-browser'],
  },
  build: {
    rollupOptions: {
      input: {
        encrypt: resolve(__dirname, 'encrypt.html'),
        decrypt: resolve(__dirname, 'decrypt.html'),
      },
    },
  },
})
