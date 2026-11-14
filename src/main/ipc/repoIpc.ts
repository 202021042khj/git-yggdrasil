// 저장소 IPC: 열기 · clone · 읽기 · 더 불러오기 · diff · 조작 실행
import fs from "node:fs";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import { git } from "@/git/cli";
import { execute } from "@/git/ops/execute";
import { fileDiff } from "@/git/diff";
import { loadMore, readRepo } from "@/git/readRepo";
import { gitAuth } from "@/github/auth";
import { currentRoot, getWindow, openRepo, requireRoot } from "@/repo/session";
import type { DiffOptions, OpExtra, OpName, RunResult } from "@shared/types/ipc";

const CLONE_TIMEOUT = 10 * 60 * 1000;


let busy = false;

export function registerRepoIpc(): void {
  ipcMain.handle("repo:pick", async () => {
    const win = getWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { title: "git 저장소 폴더 열기", properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ title: "git 저장소 폴더 열기", properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    return openRepo(r.filePaths[0]);
  });

  ipcMain.handle("repo:open", (_e, dir: string) => openRepo(dir));

  // clone: 받을 위치(상위 폴더)를 고르게 한 뒤 그 안에 저장소 이름으로 받는다
  ipcMain.handle("repo:clone", async (_e, url: string) => {
    const opts = { title: "어느 폴더 안에 받을까요?", properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
    const win = getWindow();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    const name = url.replace(/[\\/]+$/, "").split(/[\\/:]/).pop()?.replace(/\.git$/, "") || "repo";
    const dest = path.join(r.filePaths[0], name);
    if (fs.existsSync(dest)) throw new Error(`이미 같은 이름의 폴더가 있습니다: ${dest}`);
    try {
      const auth = await gitAuth().catch(() => null);
      await git(r.filePaths[0], [...(auth ? auth.args : []), "clone", "--", url, dest], { timeout: CLONE_TIMEOUT, env: auth ? auth.env : {} });
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      throw new Error(e.stderr || e.message);
    }
    return openRepo(dest);
  });

  ipcMain.handle("repo:read", () => {
    const root = currentRoot();
    return root ? readRepo(root) : null;
  });

  ipcMain.handle("repo:more", () => {
    const root = currentRoot();
    if (!root) return null;
    loadMore(root);
    return readRepo(root);
  });

  ipcMain.handle("repo:run", async (_e, { op, args, extra }: { op: OpName; args: unknown[]; extra?: OpExtra }): Promise<RunResult> => {
    const root = currentRoot();
    if (!root) return { ok: false, cmds: [], error: "열린 저장소가 없습니다." };
    if (busy) return { ok: false, cmds: [], error: "이전 작업이 아직 실행 중입니다." };
    busy = true;
    try {
      const result = await execute(root, op, args, extra);
      result.repo = await readRepo(root);
      return result;
    } finally {
      busy = false;
    }
  });

  ipcMain.handle("repo:diff", (_e, { file, commit, opts }: { file: string; commit: string | null; opts?: DiffOptions }) =>
    fileDiff(requireRoot(), file, commit, opts));
}
