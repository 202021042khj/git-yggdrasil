import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const at = (p: string) => resolve(import.meta.dirname, p);
const shared = { testTimeout: 30000, fileParallelism: false }; // 각 테스트가 임시 git 저장소를 만들고 git 을 많이 실행한다

// @/ 가 프로세스마다 다른 폴더를 가리키므로 프로젝트를 둘로 나눈다 (electron.vite.config.ts 와 같은 규칙)
export default defineConfig({
  test: {
    projects: [
      { resolve: { alias: { "@": at("src/main"), "@shared": at("src/shared") } }, test: { name: "main", include: ["tests/main/**/*.test.ts"], ...shared } },
      { resolve: { alias: { "@": at("src/renderer/src"), "@shared": at("src/shared") } }, test: { name: "renderer", include: ["tests/renderer/**/*.test.ts"], ...shared } },
    ],
  },
});
