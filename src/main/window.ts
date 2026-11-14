// 메인 창과 앱 메뉴
import { checkForUpdatesManually } from "@/update";
import path from "node:path";
import { BrowserWindow, Menu } from "electron";
import { send, setWindow } from "@/repo/session";

export const APP_NAME = "Git Yggdrasil";

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0f141c",
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setWindow(win);
  win.on("closed", () => setWindow(null));
  // 개발 중에는 Vite 개발 서버, 빌드 후에는 파일
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  return win;
}

export function buildMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { label: "업데이트 확인…", click: () => checkForUpdatesManually() },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "파일",
      submenu: [
        { label: "저장소 열기…", accelerator: "CmdOrCtrl+O", click: () => send("menu:open") },
        { label: "URL 로 clone…", accelerator: "CmdOrCtrl+Shift+O", click: () => send("menu:clone") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "찾기",
      submenu: [{ label: "커밋·파일 찾기…", accelerator: "CmdOrCtrl+K", click: () => send("menu:search") }],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
}
