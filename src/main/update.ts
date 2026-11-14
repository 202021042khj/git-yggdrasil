// 자동 업데이트 (GitHub Releases). 패키지로 설치한 앱에서만 동작한다.
// macOS 는 서명된 앱이어야 업데이트를 설치할 수 있다 (서명 없는 개발용 빌드는 확인만 하고 조용히 넘어간다).
import { app, dialog } from "electron";
import electronUpdater from "electron-updater";
import { getWindow } from "@/repo/session";

const { autoUpdater } = electronUpdater;
const FIRST_CHECK_MS = 10_000;
let manual = false;
let wired = false;

function wire(): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-not-available", () => {
    if (manual) void dialog.showMessageBox({ type: "info", message: "최신 버전입니다.", detail: `Git Yggdrasil ${app.getVersion()}` });
    manual = false;
  });
  autoUpdater.on("update-available", (info) => {
    if (manual) void dialog.showMessageBox({ type: "info", message: `새 버전 ${info.version} 을(를) 받는 중입니다.`, detail: "다 받으면 다시 알려 드립니다." });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    manual = false;
    const win = getWindow();
    const opts = { type: "info" as const, buttons: ["지금 재시작", "나중에"], defaultId: 0, cancelId: 1, message: `새 버전 ${info.version} 을(를) 받았습니다.`, detail: "지금 재시작하면 설치합니다. 나중에를 고르면 앱을 끌 때 설치합니다." };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", (err) => {
    // 자동 확인의 실패(네트워크·서명 없는 빌드)는 조용히 넘기고, 직접 확인한 경우에만 알린다
    if (manual) void dialog.showMessageBox({ type: "warning", message: "업데이트를 확인하지 못했습니다.", detail: String(err?.message ?? err) });
    manual = false;
  });
}

/** 앱을 켤 때 한 번 조용히 확인 */
export function initAutoUpdate(): void {
  if (!app.isPackaged || process.env.YGG_SMOKE) return;
  wire();
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), FIRST_CHECK_MS);
}

/** 메뉴의 "업데이트 확인…" */
export function checkForUpdatesManually(): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({ type: "info", message: "개발 실행에서는 업데이트를 확인하지 않습니다.", detail: "npm run dist 로 만든 앱에서 동작합니다." });
    return;
  }
  wire();
  manual = true;
  void autoUpdater.checkForUpdates().catch(() => undefined);
}
