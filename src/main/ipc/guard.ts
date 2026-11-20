// IPC 요청이 우리 화면(renderer)에서 왔는지 확인하고 받는다 (Electron 보안 체크리스트: Validate the sender of all IPC messages)
// 다른 곳(이동해 들어온 외부 페이지, 끼어든 iframe)에서 온 요청은 실행하지 않고 거절한다.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { t } from "@shared/i18n/i18n";

/** 개발 중에는 Vite 개발 서버, 빌드 후에는 out/renderer/index.html */
function rendererOrigin(): { dev: string | null; file: string } {
  return {
    dev: process.env.ELECTRON_RENDERER_URL ?? null,
    file: pathToFileURL(path.join(__dirname, "../renderer/index.html")).href,
  };
}

/** 이 주소가 우리 화면인가 (해시·쿼리는 무시) */
export function isAppUrl(url: string): boolean {
  if (!url) return false;
  const { dev, file } = rendererOrigin();
  const bare = url.split(/[?#]/)[0];
  if (dev) {
    try { return new URL(url).origin === new URL(dev).origin; } catch { return false; }
  }
  return bare === file;
}

function trusted(e: IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame;
  // 맨 위 프레임에서, 우리 화면 주소로 온 요청만
  return !!frame && frame === e.sender.mainFrame && isAppUrl(frame.url);
}

/** ipcMain.handle 대신 쓴다. 보낸 쪽이 우리 화면이 아니면 오류로 거절한다. */
export function handle<A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => R): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error(t("m.untrusted", { channel }));
    return fn(e, ...(args as A));
  });
}
