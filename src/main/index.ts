// Electron 메인 프로세스 진입점
import { app, BrowserWindow, safeStorage, shell } from "electron";
import { runSmoke } from "@/dev/smoke";
import { setOpener } from "@/git/ops/conflictOps";
import { registerExtraOps } from "@/git/ops/extraOps";
import { registerP3Ops } from "@/git/ops/p3Ops";
import { initAuth } from "@/github/auth";
import { registerGithubIpc } from "@/ipc/githubIpc";
import { registerQueryIpc } from "@/ipc/queryIpc";
import { registerRepoIpc } from "@/ipc/repoIpc";
import { APP_NAME, buildMenu, createWindow } from "@/window";

app.setName(APP_NAME);

registerP3Ops();
registerExtraOps();
registerRepoIpc();
registerQueryIpc();
registerGithubIpc();

void app.whenReady().then(() => {
  // 점검 실행에서는 저장된 토큰을 읽지 않는다 (macOS 키체인 확인 창이 떠서 멈추지 않도록)
  if (!process.env.YGG_SMOKE) initAuth({ safeStorage, userData: app.getPath("userData") });
  setOpener((file) => void shell.openPath(file)); // 충돌 파일을 기본 에디터로 연다
  buildMenu();
  const win = createWindow();
  if (process.env.YGG_SMOKE) runSmoke(win, process.env.YGG_SMOKE);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
