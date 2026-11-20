// 자동 업데이트 (GitHub Releases). 패키지로 설치한 앱에서만 동작한다.
// macOS 는 서명된 앱이어야 업데이트를 설치할 수 있다 (서명 없는 개발용 빌드는 확인만 하고 조용히 넘어간다).
import { app, dialog } from "electron";
import electronUpdater from "electron-updater";
import { getWindow } from "@/repo/session";
import { t } from "@shared/i18n/i18n";

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
    if (manual) void dialog.showMessageBox({ type: "info", message: t("upd.latest"), detail: `Yggdrasil ${app.getVersion()}` });
    manual = false;
  });
  autoUpdater.on("update-available", (info) => {
    if (manual) void dialog.showMessageBox({ type: "info", message: t("upd.downloading", { version: info.version }), detail: t("upd.downloadingDetail") });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    manual = false;
    const win = getWindow();
    const opts = { type: "info" as const, buttons: [t("upd.restart"), t("upd.later")], defaultId: 0, cancelId: 1, message: t("upd.downloaded", { version: info.version }), detail: t("upd.downloadedDetail") };
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", (err) => {
    // 자동 확인의 실패(네트워크·서명 없는 빌드)는 조용히 넘기고, 직접 확인한 경우에만 알린다
    if (manual) void dialog.showMessageBox({ type: "warning", message: t("upd.failed"), detail: String(err?.message ?? err) });
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
    void dialog.showMessageBox({ type: "info", message: t("upd.dev"), detail: t("upd.devDetail") });
    return;
  }
  wire();
  manual = true;
  void autoUpdater.checkForUpdates().catch(() => undefined);
}
