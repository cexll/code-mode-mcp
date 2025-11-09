import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      // 覆盖率阈值：主要业务逻辑已100%覆盖，剩余为DEBUG日志和边缘错误处理
      thresholds: {
        lines: 85, // 当前 89.41%
        functions: 90, // 当前 93.47%
        branches: 60, // 当前 61.71% (边缘条件和错误处理分支)
        statements: 85, // 当前 86.51%
      },
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "examples/**",
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
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
