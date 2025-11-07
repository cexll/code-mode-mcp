import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // 覆盖率阈值：已达到语句/行/函数 99-100%，分支 82%（剩余为防御性代码）
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 82,  // 实际 82.35%，剩余分支为难以触发的防御性代码
        statements: 90,
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        'examples/**',
      ],
      // 只收集 src/ 下的覆盖率
      all: true,
    },
    // 超时设置（MCP 连接可能需要时间）
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

