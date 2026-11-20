// Electron 메인 프로세스 진입점
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, safeStorage } from "electron";
import { runSmoke } from "@/dev/smoke";
import { setOpener } from "@/git/ops/conflictOps";
import { registerExtraOps } from "@/git/ops/extraOps";
import { registerAdvancedOps } from "@/git/ops/advancedOps";
import { initAuth } from "@/github/auth";
import { registerGithubIpc } from "@/ipc/githubIpc";
import { registerQueryIpc } from "@/ipc/queryIpc";
import { registerRepoIpc } from "@/ipc/repoIpc";
import { applyToWindow, initSettings, onLocaleChange, openInEditor } from "@/settings";
import { initAutoUpdate } from "@/update";
import { APP_NAME, applyDevDockIcon, buildMenu, createWindow } from "@/window";

app.setName(APP_NAME);
// 점검 실행(YGG_SMOKE)·E2E 테스트(YGG_PROFILE)는 따로 된 프로필을 쓴다
// (실제 설정·최근 저장소 목록·로그인을 건드리지 않고, 키체인 확인 창도 띄우지 않게)
const isolated = !!(process.env.YGG_SMOKE || process.env.YGG_PROFILE);
if (isolated) {
  const profile = process.env.YGG_PROFILE || path.join(os.tmpdir(), "ygg-smoke-profile");
  if (process.env.YGG_SMOKE) fs.rmSync(profile, { recursive: true, force: true }); // 매번 기본 설정으로
  app.setPath("userData", profile);
}

registerAdvancedOps();
registerExtraOps();
registerRepoIpc();
registerQueryIpc();
registerGithubIpc();

void app.whenReady().then(() => {
  if (!isolated) initAuth({ safeStorage, userData: app.getPath("userData") });
  // 점검·테스트 실행은 YGG_LANG=ko|en 으로 화면 언어를 정할 수 있다 (프로필이 매번 지워지는 YGG_SMOKE 용)
  const lang = process.env.YGG_LANG;
  initSettings(app.getPath("userData"), isolated && (lang === "ko" || lang === "en" || lang === "system") ? { language: lang } : {});
  onLocaleChange(buildMenu); // 설정에서 언어를 바꾸면 앱 메뉴도 그 언어로
  setOpener(openInEditor); // 충돌 파일을 설정한 에디터(없으면 기본 앱)로 연다
  buildMenu();
  applyDevDockIcon();
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
