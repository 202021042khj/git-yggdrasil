import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src/main"), "@shared": resolve(import.meta.dirname, "src/shared") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false, // 각 테스트가 임시 git 저장소를 만들고 git 을 많이 실행한다
  },
});
