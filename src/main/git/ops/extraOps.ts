// 서브모듈 받기 · worktree 만들기·지우기·정리
import fs from "node:fs";
import path from "node:path";
import { readSubmodules, readWorktrees } from "@/git/extras";
import { registerOps } from "@/git/ops/execute";
import { NET, type OpFn } from "@/git/ops/context";

/** 서브모듈 받기·맞추기 (path 가 없으면 전부). 기록된 커밋으로 맞춘다 */
const submoduleUpdate: OpFn = async (ctx, [subPath]: [string | null]) => {
  const subs = await readSubmodules(ctx.root);
  if (!subs.length) throw new Error("이 저장소에는 서브모듈이 없습니다.");
  if (subPath && !subs.some((s) => s.path === subPath)) throw new Error(`서브모듈이 아닙니다: ${subPath}`);
  await ctx.run(["submodule", "update", "--init", "--recursive", ...(subPath ? ["--", subPath] : [])], { ...NET, timeout: 10 * 60 * 1000 });
};

const safeName = (b: string) => b.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";

/** 브랜치를 다른 폴더에 함께 체크아웃 (parent 안에 <저장소>-<브랜치> 폴더). 화면이 고른 상위 폴더만 받는다 */
const worktreeAdd: OpFn = async (ctx, [branch, parent]: [string, string]) => {
  if (!parent || !path.isAbsolute(parent) || !fs.statSync(parent, { throwIfNoEntry: false })?.isDirectory()) throw new Error("worktree 를 만들 폴더를 찾을 수 없습니다.");
  const used = (await readWorktrees(ctx.root)).find((w) => w.branch === branch);
  if (used) throw new Error(`${branch} 는 이미 다른 worktree 에서 쓰고 있습니다: ${used.path}`);
  const dest = path.join(parent, `${path.basename((await readWorktrees(ctx.root))[0]?.path || ctx.root)}-${safeName(branch)}`);
  if (fs.existsSync(dest)) throw new Error(`이미 같은 이름의 폴더가 있습니다: ${dest}`);
  await ctx.run(["worktree", "add", dest, branch]);
  ctx.note(`# ${dest} 에 ${branch} 를 체크아웃`);
};

/** worktree 지우기: 저장되지 않은 변경이 있으면 git 이 거절한다 (강제로 지우지 않음) */
const worktreeRemove: OpFn = async (ctx, [wtPath]: [string]) => {
  const w = (await readWorktrees(ctx.root)).find((x) => x.path === wtPath);
  if (!w) throw new Error(`worktree 가 아닙니다: ${wtPath}`);
  if (w.main) throw new Error("원래 저장소는 지울 수 없습니다.");
  if (w.current) throw new Error("지금 열어 둔 worktree 는 지울 수 없습니다. 다른 곳을 연 뒤 지우세요.");
  if (w.prunable) { await ctx.run(["worktree", "prune"]); return; }
  try {
    await ctx.run(["worktree", "remove", wtPath]);
  } catch (err) {
    if (/contains modified or untracked files|is dirty/.test((err as { stderr?: string }).stderr || "")) {
      throw new Error(`${wtPath} 에 커밋하지 않은 변경이 있어 지우지 않았습니다. 그 worktree 를 열어 커밋하거나 정리한 뒤 다시 지우세요.`);
    }
    throw err;
  }
};

export function registerExtraOps(): void {
  registerOps({ submoduleUpdate, worktreeAdd, worktreeRemove });
}
