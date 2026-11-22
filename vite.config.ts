/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiPort = process.env.API_PORT ?? '3002'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
