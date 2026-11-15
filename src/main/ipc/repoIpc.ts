// 저장소 IPC: 열기 · clone · 읽기 · 더 불러오기 · diff · 조작 실행
import fs from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import { handle } from "@/ipc/guard";
import { git } from "@/git/cli";
import { execute } from "@/git/ops/execute";
import { authUrlFromError, forgetCredential, saveCredential, systemHelper } from "@/git/credential";
import { explainRemoteError, hintText } from "@/git/remoteErrors";
import { fileDiff } from "@/git/diff";
import { loadMore, readRepo } from "@/git/readRepo";
import { gitAuth } from "@/github/auth";
import { currentRoot, getWindow, openRepo, requireRoot } from "@/repo/session";
import type { DiffOptions, OpExtra, OpName, RunResult } from "@shared/types/ipc";

const CLONE_TIMEOUT = 10 * 60 * 1000;


let busy = false;

export function registerRepoIpc(): void {
  handle("repo:pick", async () => {
    const win = getWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { title: "git 저장소 폴더 열기", properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ title: "git 저장소 폴더 열기", properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    return openRepo(r.filePaths[0]);
  });

  handle("repo:open", (_e, dir: string) => openRepo(dir));
  handle("repo:pickDir", async (_e, title: string) => {
    const opts = { title: String(title || "폴더 고르기"), properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
    const win = getWindow();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  // clone: 받을 위치(상위 폴더)를 고르게 한 뒤 그 안에 저장소 이름으로 받는다
  // retry: 인증 때문에 실패한 직후 다시 시도할 때는 방금 고른 폴더를 그대로 쓴다 (경로는 화면에서 받지 않는다)
  let lastCloneParent: string | null = null;
  handle("repo:clone", async (_e, url: string, retry = false) => {
    const opts = { title: "어느 폴더 안에 받을까요?", properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
    const win = getWindow();
    const r = retry && lastCloneParent ? { canceled: false, filePaths: [lastCloneParent] }
      : win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    lastCloneParent = r.filePaths[0];
    const name = url.replace(/[\\/]+$/, "").split(/[\\/:]/).pop()?.replace(/\.git$/, "") || "repo";
    const dest = path.join(r.filePaths[0], name);
    if (fs.existsSync(dest)) throw new Error(`이미 같은 이름의 폴더가 있습니다: ${dest}`);
    try {
      const auth = await gitAuth().catch(() => null);
      await git(r.filePaths[0], [...(auth ? auth.args : []), "clone", "--", url, dest], { timeout: CLONE_TIMEOUT, env: auth ? auth.env : {}, net: true });
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      const authUrl = authUrlFromError(e.stderr || e.message);
      // GitHub 밖 HTTPS 호스트: 화면이 로그인 창을 띄우고 다시 시도하도록 표시를 붙인다
      if (authUrl && !/^https:\/\/github\.com$/.test(authUrl)) throw new Error(`AUTH_REQUIRED ${authUrl}`);
      const hint = explainRemoteError(e.stderr || e.message);
      throw new Error(hint ? `${hintText(hint)}\n\n(git: ${e.stderr || e.message})` : e.stderr || e.message);
    }
    return openRepo(dest);
  });

  // 자격 증명: 저장소가 안 열려 있어도 된다 (clone 전에 로그인하는 경우)
  // 도우미가 없으면 던지지 않고 needsHelper 로 알린다 (IPC 는 오류 코드를 넘기지 못한다)
  handle("cred:save", async (_e, { url, username, password, enableHelper }: { url: string; username: string; password: string; enableHelper?: boolean }) => {
    try {
      return await saveCredential(currentRoot(), url, username, password, !!enableHelper);
    } catch (err) {
      if ((err as { code?: string }).code === "NO_HELPER") return { helpers: [], enabledHelper: null, needsHelper: systemHelper(), message: (err as Error).message };
      throw err;
    }
  });
  handle("cred:forget", (_e, url: string) => forgetCredential(currentRoot(), url));

  handle("repo:read", () => {
    const root = currentRoot();
    return root ? readRepo(root) : null;
  });

  handle("repo:more", () => {
    const root = currentRoot();
    if (!root) return null;
    loadMore(root);
    return readRepo(root);
  });

  handle("repo:run", async (_e, { op, args, extra }: { op: OpName; args: unknown[]; extra?: OpExtra }): Promise<RunResult> => {
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

  handle("repo:diff", (_e, { file, commit, opts }: { file: string; commit: string | null; opts?: DiffOptions }) =>
    fileDiff(requireRoot(), file, commit, opts));
}
