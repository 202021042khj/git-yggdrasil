// 앱 설정: userData/settings.json 에 저장하고, 화면 색·확대·에디터를 적용한다
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { DEFAULT_SETTINGS, type Settings } from "@shared/types/ipc";

let file = "";
let current: Settings = { ...DEFAULT_SETTINGS };

/** 잘못된 값은 기본값으로 (파일을 손으로 고쳤거나 예전 버전의 설정일 수 있다) */
export function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const num = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
  return {
    theme: r.theme === "light" || r.theme === "dark" || r.theme === "system" ? r.theme : DEFAULT_SETTINGS.theme,
    zoom: Math.round(num(r.zoom, 0.8, 1.5, DEFAULT_SETTINGS.zoom) * 100) / 100,
    editor: typeof r.editor === "string" ? r.editor.trim().slice(0, 500) : DEFAULT_SETTINGS.editor,
    autoFetchMinutes: Math.round(num(r.autoFetchMinutes, 0, 240, DEFAULT_SETTINGS.autoFetchMinutes)),
    reopenLast: typeof r.reopenLast === "boolean" ? r.reopenLast : DEFAULT_SETTINGS.reopenLast,
    pullMode: r.pullMode === "rebase" ? "rebase" : "merge",
  };
}

/** 에디터 명령을 프로그램과 인자로 나눈다 (셸을 거치지 않는다). 따옴표로 공백 있는 경로를 감쌀 수 있다 */
export function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export const settings = (): Settings => current;

function apply(): void {
  nativeTheme.themeSource = current.theme;
  for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(current.zoom);
}

/** 창이 새로 열리거나 다시 불러올 때도 확대를 맞춘다 */
export function applyToWindow(win: BrowserWindow): void {
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(current.zoom));
}

/** 파일을 설정한 에디터로 연다 (비어 있으면 OS 기본 앱). 실패하면 기본 앱으로 */
export function openInEditor(target: string): void {
  const [prog, ...args] = splitCommand(current.editor);
  if (!prog) { void shell.openPath(target); return; }
  execFile(prog, [...args, target], { env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin` } }, (err) => {
    if (err) void shell.openPath(target);
  });
}

export function initSettings(userData: string): void {
  file = path.join(userData, "settings.json");
  try { current = sanitize(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { current = { ...DEFAULT_SETTINGS }; }
  apply();
  ipcMain.handle("settings:get", () => current);
  ipcMain.handle("settings:set", (_e, patch: Partial<Settings>) => {
    current = sanitize({ ...current, ...patch });
    try { fs.writeFileSync(file, JSON.stringify(current, null, 2)); } catch { /* 저장 못 해도 이번 실행에는 적용 */ }
    apply();
    return current;
  });
}
