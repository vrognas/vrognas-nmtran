import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './src',
    include: ['**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/index.ts',
        '**/test/**',
        'server.ts',
        'types.ts',
        'hoverInfo.ts',
        'services/completionService.ts',
        'services/diagnosticsService.ts',
        'services/formattingService.ts',
        'utils/performanceMonitor.ts'
      ],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 }
    }
  }
})
