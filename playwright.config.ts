import { defineConfig } from "@playwright/test";

// Electron 앱을 실제로 띄워 화면에서 조작해 보는 E2E 테스트 (npm run e2e, 먼저 빌드)
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1, // 창 하나씩
  reporter: [["list"]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  outputDir: "test-results",
});
