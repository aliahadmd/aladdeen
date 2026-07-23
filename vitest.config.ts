import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      reporter: ['text', 'html']
    }
  },
  resolve: {
    alias: {
      '@shared': new URL('./src/shared', import.meta.url).pathname,
      '@renderer': new URL('./src/renderer/src', import.meta.url).pathname,
      '@main': new URL('./src/main', import.meta.url).pathname
    }
  }
})
