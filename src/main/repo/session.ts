// 열린 저장소 세션: 지금 저장소, 파일 변경 감지, 화면 창
import fs from "node:fs";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import { repoRoot } from "@/git/cli";
import { readRepo } from "@/git/readRepo";
import { t } from "@shared/i18n/i18n";
import type { RepoState } from "@shared/types/repo";

let win: BrowserWindow | null = null;
let current: string | null = null;
let watchers: fs.FSWatcher[] = [];
let debounce: NodeJS.Timeout | null = null;

export const setWindow = (w: BrowserWindow | null) => { win = w; };
export const getWindow = () => win;
export const currentRoot = () => current;

/** 화면으로 이벤트 보내기 (창이 닫혔으면 무시) */
export function send(channel: string, data?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

/** 저장소 파일이 바뀌면(에디터 저장, 터미널에서 git 실행 등) 화면에 알린다 */
function watch(root: string): void {
  watchers.forEach((w) => w.close());
  watchers = [];
  const notify = (file: string | null) => {
    if (file && /(^|[\\/])(node_modules|\.git[\\/]objects)([\\/]|$)/.test(file)) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => send("repo:changed"), 250);
  };
  try { watchers.push(fs.watch(root, { recursive: true }, (_e, f) => notify(f))); } catch { /* 감시 못 하면 수동 새로고침 */ }
  try { watchers.push(fs.watch(path.join(root, ".git"), { recursive: true }, (_e, f) => notify(path.join(".git", f || "")))); } catch { /* 동일 */ }
}

export async function openRepo(dir: string): Promise<RepoState> {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(t("m.noFolder", { path: dir }));
  // git 저장소가 아니어도 연다 (화면이 "git 시작하기" 를 보여 준다)
  const root = (await repoRoot(dir)) ?? path.resolve(dir);
  current = root;
  watch(root);
  app.addRecentDocument(root);
  return readRepo(root);
}

export function requireRoot(): string {
  if (!current) throw new Error(t("m.noRepo"));
  return current;
}
