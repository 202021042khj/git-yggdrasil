import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// 프로세스마다 "@/" 가 자기 src 폴더를 가리킨다. 공용 타입·상수는 "@shared/".
const shared = { "@shared": resolve(import.meta.dirname, "src/shared") };

export default defineConfig({
  main: {
    resolve: { alias: { "@": resolve(import.meta.dirname, "src/main"), ...shared } },
  },
  preload: {
    resolve: { alias: shared },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/src"), ...shared } },
  },
});
