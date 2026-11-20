// 브랜치 조작: checkout · 만들기 · 이름 변경 · 원격에서 가져오기 · 삭제 · 포인터 이동 · reset
import { git } from "@/git/cli";
import { NET, backup, headInfo, rev, upstreamOf, type OpFn } from "@/git/ops/context";
import { t } from "@shared/i18n/i18n";

const checkout: OpFn = async (ctx, [name]: [string]) => {
  await ctx.run(["switch", name]);
};

const switchCreate: OpFn = async (ctx, [name]: [string]) => {
  await ctx.run(["switch", "-c", name]);
};

const createBranch: OpFn = async (ctx, [name, id]: [string, string]) => {
  await ctx.run(["branch", name, id]);
};

/** 이름 바꾸기. withRemote 면 원격에도 새 이름으로 올리고 옛 이름을 지운다. */
const renameBranch: OpFn = async (ctx, [from, to, withRemote]: [string, string, boolean]) => {
  const up = await upstreamOf(ctx.root, from);
  await ctx.run(["branch", "-m", from, to]);
  if (!withRemote || !up) return;
  const [remote, ...rest] = up.split("/");
  await ctx.run(["push", "-u", remote, `${to}:${to}`], NET);
  try {
    await ctx.run(["push", remote, "--delete", rest.join("/")], NET);
  } catch (err) {
    // 원격의 기본 브랜치는 지울 수 없다 (GitHub 포함). 새 이름은 이미 올렸으니 실패로 치지 않는다.
    if (/refusing to delete the current branch|default branch/i.test((err as { stderr?: string }).stderr || "")) {
      ctx.warn(t("m.renameDefault", { upstream: up, to }));
    } else throw err;
  }
};

/** 원격에만 있는 브랜치를 같은 이름의 로컬 브랜치로 가져와 체크아웃 */
const checkoutRemote: OpFn = async (ctx, [remoteBranch]: [string]) => {
  const name = remoteBranch.split("/").slice(1).join("/");
  const exists = await git(ctx.root, ["rev-parse", "--verify", "-q", `refs/heads/${name}`], { allowFail: true });
  if (exists) throw new Error(t("m.localExists", { name }));
  await ctx.run(["switch", "--track", "-c", name, remoteBranch]);
};

const deleteBranch: OpFn = async (ctx, [name]: [string]) => {
  // 병합되지 않은 브랜치는 git 이 거절한다 (-d). 강제 삭제는 일부러 막아 둔다.
  await ctx.run(["branch", "-d", name]);
};

const moveBranch: OpFn = async (ctx, [branch, id]: [string, string]) => {
  const { branch: cur } = await headInfo(ctx.root);
  await backup(ctx.root, branch, await rev(ctx.root, branch));
  if (branch === cur) await ctx.run(["reset", "--keep", id]);
  else await ctx.run(["branch", "-f", branch, id]);
};

/** keep: 파일까지 그 커밋으로 맞추되, 커밋하지 않은 변경과 겹치면 git 이 거절한다 (hard 보다 안전) */
const resetHead: OpFn = async (ctx, [id, mode]: [string, "soft" | "mixed" | "hard" | "keep"]) => {
  const { tip } = await headInfo(ctx.root);
  await backup(ctx.root, "reset", tip);
  await ctx.run(["reset", `--${mode || "mixed"}`, id]);
};

export const branchOps = { checkout, switchCreate, createBranch, renameBranch, checkoutRemote, deleteBranch, moveBranch, resetHead };
