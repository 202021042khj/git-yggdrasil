// 저장소 IPC: 열기 · clone · 읽기 · 더 불러오기 · diff · 조작 실행
import fs from "node:fs";
import path from "node:path";
import { clipboard, dialog } from "electron";
import { handle } from "@/ipc/guard";
import { git, repoRoot } from "@/git/cli";
import { execute } from "@/git/ops/execute";
import { createContext } from "@/git/ops/context";
import { patchText } from "@/git/ops/patchOps";
import { authUrlFromError, forgetCredential, saveCredential, systemHelper } from "@/git/credential";
import { explainRemoteError, hintText } from "@/git/remoteErrors";
import { fileDiff } from "@/git/diff";
import { loadMore, readRepo } from "@/git/readRepo";
import { gitAuth } from "@/github/auth";
import { currentRoot, getWindow, openRepo, requireRoot } from "@/repo/session";
import { t } from "@shared/i18n/i18n";
import type { DiffOptions, OpExtra, OpName, PatchSource, RunResult } from "@shared/types/ipc";

const CLONE_TIMEOUT = 10 * 60 * 1000;

/** 파일 경로를 인자로 받는 조작: 화면이 보낸 경로로는 실행하지 않고, main 의 저장·열기 창에서 고른 경로로만 실행한다 */
const DIALOG_OPS = new Set<OpName>(["patchExport", "patchApply"]);
const PATCH_SOURCES = new Set<PatchSource>(["commits", "staged", "working"]);

let busy = false;

/** 조작 하나를 다른 조작과 겹치지 않게 실행하고, 끝나면 저장소 상태를 붙여 돌려준다 */
async function exclusive(fn: (root: string) => Promise<RunResult>): Promise<RunResult> {
  const root = currentRoot();
  if (!root) return { ok: false, cmds: [], error: t("m.noRepo") };
  if (busy) return { ok: false, cmds: [], error: t("act.busy") };
  busy = true;
  try {
    const result = await fn(root);
    if (!result.canceled) result.repo = await readRepo(root);
    return result;
  } finally {
    busy = false;
  }
}

/** 화면에서 온 패치 대상 검사 (커밋 id 는 16진수만) */
function patchArgs(source: PatchSource, ids: unknown): string[] {
  if (!PATCH_SOURCES.has(source)) throw new Error(t("m.unknownOp", { op: String(source) }));
  const list = Array.isArray(ids) ? ids.map(String) : [];
  if (list.some((id) => !/^[0-9a-f]{4,64}$/.test(id))) throw new Error(t("m.patchEmpty"));
  return source === "commits" ? list : [];
}

export function registerRepoIpc(): void {
  handle("repo:pick", async () => {
    const win = getWindow();
    const r = win
      ? await dialog.showOpenDialog(win, { title: t("m.pickRepo"), properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ title: t("m.pickRepo"), properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    return openRepo(r.filePaths[0]);
  });

  handle("repo:open", (_e, dir: string) => openRepo(dir));

  // 지금 연 폴더가 git 저장소가 아니면 git init 하고 다시 연다 (감시도 .git 까지 새로)
  handle("repo:init", async () => {
    const dir = requireRoot();
    if (await repoRoot(dir)) return openRepo(dir); // 그 사이 터미널에서 init 했으면 그대로 연다
    await git(dir, ["init"]);
    return openRepo(dir);
  });
  handle("repo:pickDir", async (_e, title: string) => {
    const opts = { title: String(title || t("m.pickDir")), properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
    const win = getWindow();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  // clone: 받을 위치(상위 폴더)를 고르게 한 뒤 그 안에 저장소 이름으로 받는다
  // retry: 인증 때문에 실패한 직후 다시 시도할 때는 방금 고른 폴더를 그대로 쓴다 (경로는 화면에서 받지 않는다)
  let lastCloneParent: string | null = null;
  handle("repo:clone", async (_e, url: string, retry = false) => {
    const opts = { title: t("m.pickCloneParent"), properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory"> };
    const win = getWindow();
    const r = retry && lastCloneParent ? { canceled: false, filePaths: [lastCloneParent] }
      : win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    lastCloneParent = r.filePaths[0];
    const name = url.replace(/[\\/]+$/, "").split(/[\\/:]/).pop()?.replace(/\.git$/, "") || "repo";
    const dest = path.join(r.filePaths[0], name);
    if (fs.existsSync(dest)) throw new Error(t("m.folderExists", { path: dest }));
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

  handle("repo:run", (_e, { op, args, extra }: { op: OpName; args: unknown[]; extra?: OpExtra }): Promise<RunResult> => {
    if (DIALOG_OPS.has(op)) return Promise.resolve({ ok: false, cmds: [], error: t("m.unknownOp", { op }) });
    return exclusive((root) => execute(root, op, args, extra));
  });

  // 패치 저장: 저장 창에서 고른 파일에 format-patch / diff 결과를 쓴다
  handle("patch:save", (_e, { source, ids }: { source: PatchSource; ids?: string[] }) => {
    const list = patchArgs(source, ids);
    return exclusive(async (root) => {
      const name = source === "commits" ? (list.length === 1 ? `${list[0].slice(0, 7)}.patch` : "commits.patch") : `${source}.diff`;
      const opts = { title: t("m.patchSaveTitle"), defaultPath: path.join(root, name),
        filters: [{ name: "Patch", extensions: ["patch", "diff", "mbox"] }] };
      const win = getWindow();
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return { ok: false, canceled: true, cmds: [] };
      return execute(root, "patchExport", [source, list, r.filePath]);
    });
  });

  // 패치 복사: 같은 내용을 파일 대신 클립보드로 (조작이 아니라 실행 기록만 돌려준다)
  handle("patch:copy", (_e, { source, ids }: { source: PatchSource; ids?: string[] }) => {
    const list = patchArgs(source, ids);
    return exclusive(async (root) => {
      const { ctx, cmds, warnings } = createContext(root);
      try {
        clipboard.writeText(await patchText(ctx, source, list));
        cmds.push(`# ${t("m.patchCopied")}`);
        return { ok: true, cmds, warnings };
      } catch (err) {
        const e = err as { stderr?: string; message: string };
        return { ok: false, cmds, error: e.stderr || e.message };
      }
    });
  });

  // 패치 적용: 열기 창에서 고른 파일만 (메일 형식이면 git am --3way, 아니면 git apply)
  handle("patch:apply", () => exclusive(async (root) => {
    const opts = { title: t("m.patchApplyTitle"), properties: ["openFile"] as Array<"openFile">,
      filters: [{ name: "Patch", extensions: ["patch", "diff", "mbox", "eml", "txt"] }, { name: "*", extensions: ["*"] }] };
    const win = getWindow();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true, cmds: [] };
    return execute(root, "patchApply", [r.filePaths[0]]);
  }));

  handle("repo:diff", (_e, { file, commit, opts }: { file: string; commit: string | null; opts?: DiffOptions }) =>
    fileDiff(requireRoot(), file, commit, opts));
}
