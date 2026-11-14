// Electron 메인 프로세스 진입점
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, safeStorage } from "electron";
import { runSmoke } from "@/dev/smoke";
import { setOpener } from "@/git/ops/conflictOps";
import { registerExtraOps } from "@/git/ops/extraOps";
import { registerP3Ops } from "@/git/ops/p3Ops";
import { initAuth } from "@/github/auth";
import { registerGithubIpc } from "@/ipc/githubIpc";
import { registerQueryIpc } from "@/ipc/queryIpc";
import { registerRepoIpc } from "@/ipc/repoIpc";
import { applyToWindow, initSettings, openInEditor } from "@/settings";
import { initAutoUpdate } from "@/update";
import { APP_NAME, buildMenu, createWindow } from "@/window";

app.setName(APP_NAME);
// 점검 실행(YGG_SMOKE)·E2E 테스트(YGG_PROFILE)는 따로 된 프로필을 쓴다
// (실제 설정·최근 저장소 목록·로그인을 건드리지 않고, 키체인 확인 창도 띄우지 않게)
const isolated = !!(process.env.YGG_SMOKE || process.env.YGG_PROFILE);
if (isolated) {
  const profile = process.env.YGG_PROFILE || path.join(os.tmpdir(), "ygg-smoke-profile");
  if (process.env.YGG_SMOKE) fs.rmSync(profile, { recursive: true, force: true }); // 매번 기본 설정으로
  app.setPath("userData", profile);
}

registerP3Ops();
registerExtraOps();
registerRepoIpc();
registerQueryIpc();
registerGithubIpc();

void app.whenReady().then(() => {
  if (!isolated) initAuth({ safeStorage, userData: app.getPath("userData") });
  initSettings(app.getPath("userData"));
  setOpener(openInEditor); // 충돌 파일을 설정한 에디터(없으면 기본 앱)로 연다
  buildMenu();
  const win = createWindow();
  applyToWindow(win);
  if (!isolated) initAutoUpdate();
  if (process.env.YGG_SMOKE) runSmoke(win, process.env.YGG_SMOKE);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
