// 서브모듈 받기 · worktree 만들기·지우기·정리 · 커밋 서명 켜기·끄기
import fs from "node:fs";
import path from "node:path";
import { readSubmodules, readWorktrees } from "@/git/extras";
import { registerOps } from "@/git/ops/execute";
import { skipHooksConfigArgs } from "@/git/hooks";
import { signingConfigArgs } from "@/git/sign";
import { NET, type OpFn } from "@/git/ops/context";
import { t } from "@shared/i18n/i18n";

/** 서브모듈 받기·맞추기 (path 가 없으면 전부). 기록된 커밋으로 맞춘다 */
const submoduleUpdate: OpFn = async (ctx, [subPath]: [string | null]) => {
  const subs = await readSubmodules(ctx.root);
  if (!subs.length) throw new Error(t("m.noSubmodules"));
  if (subPath && !subs.some((s) => s.path === subPath)) throw new Error(t("m.notSubmodule", { path: subPath }));
  await ctx.run(["submodule", "update", "--init", "--recursive", ...(subPath ? ["--", subPath] : [])], { ...NET, timeout: 10 * 60 * 1000 });
};

const safeName = (b: string) => b.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";

/** 브랜치를 다른 폴더에 함께 체크아웃 (parent 안에 <저장소>-<브랜치> 폴더). 화면이 고른 상위 폴더만 받는다 */
const worktreeAdd: OpFn = async (ctx, [branch, parent]: [string, string]) => {
  if (!parent || !path.isAbsolute(parent) || !fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) throw new Error(t("m.wtNoParent"));
  const used = (await readWorktrees(ctx.root)).find((w) => w.branch === branch);
  if (used) throw new Error(t("m.wtUsed", { branch, path: used.path }));
  const dest = path.join(parent, `${path.basename((await readWorktrees(ctx.root))[0]?.path || ctx.root)}-${safeName(branch)}`);
  if (fs.existsSync(dest)) throw new Error(t("m.folderExists", { path: dest }));
  await ctx.run(["worktree", "add", dest, branch]);
  ctx.note(`# ${t("m.wtNote", { path: dest, branch })}`);
};

/** worktree 지우기: 저장되지 않은 변경이 있으면 git 이 거절한다 (강제로 지우지 않음) */
const worktreeRemove: OpFn = async (ctx, [wtPath]: [string]) => {
  const w = (await readWorktrees(ctx.root)).find((x) => x.path === wtPath);
  if (!w) throw new Error(t("m.notWorktree", { path: wtPath }));
  if (w.main) throw new Error(t("m.wtMain"));
  if (w.current) throw new Error(t("m.wtCurrent"));
  if (w.prunable) { await ctx.run(["worktree", "prune"]); return; }
  try {
    await ctx.run(["worktree", "remove", wtPath]);
  } catch (err) {
    if (/contains modified or untracked files|is dirty/.test((err as { stderr?: string }).stderr || "")) {
      throw new Error(t("m.wtDirty", { path: wtPath }));
    }
    throw err;
  }
};

/** 커밋 서명 켜기·끄기: 이 저장소(.git/config)에만 쓴다. 전역 설정·키·암호는 건드리지 않는다 */
const setSigning: OpFn = async (ctx, [enabled]: [boolean]) => {
  await ctx.run(signingConfigArgs(!!enabled));
};

/** hook 건너뛰기 (--no-verify) 켜기·끄기: 이 저장소(.git/config)에만 쓴다 */
const setSkipHooks: OpFn = async (ctx, [on]: [boolean]) => {
  await ctx.run(skipHooksConfigArgs(!!on));
};

export function registerExtraOps(): void {
  registerOps({ submoduleUpdate, worktreeAdd, worktreeRemove, setSigning, setSkipHooks });
}
