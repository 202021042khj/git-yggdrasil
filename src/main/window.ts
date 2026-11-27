// 메인 창과 앱 메뉴
import { checkForUpdatesManually } from "@/update";
import path from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { isAppUrl } from "@/ipc/guard";
import { send, setWindow } from "@/repo/session";
import { t } from "@shared/i18n/i18n";

export const APP_NAME = "Yggdrasil";

/** 개발 실행(npm run dev)에서도 우리 아이콘을 쓴다. 패키지 앱은 electron-builder 가 build/icon.png 로 아이콘을 넣는다 */
const DEV_ICON = app.isPackaged ? undefined : path.join(app.getAppPath(), "build/icon.png");

/** macOS Dock 아이콘 (개발 실행에서만: 패키지 앱은 앱 묶음의 icon.icns 를 쓴다) */
export function applyDevDockIcon(): void {
  if (DEV_ICON && process.platform === "darwin") app.dock?.setIcon(DEV_ICON);
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0f141c",
    title: APP_NAME,
    icon: DEV_ICON, // Windows · Linux 창/작업 표시줄 아이콘 (macOS 는 무시)
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 점검 도구(window.__yggDebug)는 개발·테스트 실행에서만 켠다. 배포판(패키지 앱)에는 넣지 않는다.
      additionalArguments: app.isPackaged ? [] : ["--ygg-debug"],
    },
  });
  guardNavigation(win);
  setWindow(win);
  win.on("closed", () => setWindow(null));
  // 개발 중에는 Vite 개발 서버, 빌드 후에는 파일
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  return win;
}

/** 링크로 새 창이 열리거나 다른 페이지로 넘어가지 않게 막는다 (Electron 보안 체크리스트 13·14).
 *  https 링크는 OS 기본 브라우저로 넘긴다. */
function guardNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return; // 다시 불러오기 등 우리 화면 안의 이동은 그대로
    e.preventDefault();
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
  });
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
}

export function buildMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { label: t("menu.checkUpdates"), click: () => checkForUpdatesManually() },
        { label: t("menu.settings"), accelerator: "CmdOrCtrl+,", click: () => send("menu:settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: t("menu.file"),
      submenu: [
        { label: t("menu.open"), accelerator: "CmdOrCtrl+O", click: () => send("menu:open") },
        { label: t("menu.clone"), accelerator: "CmdOrCtrl+Shift+O", click: () => send("menu:clone") },
        { type: "separator" },
        { label: t("menu.applyPatch"), click: () => send("menu:applyPatch") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: t("menu.find"),
      submenu: [{ label: t("menu.search"), accelerator: "CmdOrCtrl+K", click: () => send("menu:search") }],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
}
