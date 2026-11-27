// 원격 조작: fetch · pull · push · 원격 추가·주소 변경·삭제
import { git, gitRaw } from "@/git/cli";
import { verifyArgs, withHooks } from "@/git/hooks";
import { commitTree } from "@/git/sign";
import { runOrStop } from "@/git/ops/conflictOps";
import { NET, backup, headInfo, rev, short, upstreamOf, type OpContext, type OpError, type OpFn } from "@/git/ops/context";
import { chain, conflictError, firstParentRange } from "@/git/ops/historyOps";
import { t } from "@shared/i18n/i18n";

const fetch: OpFn = async (ctx) => {
  await ctx.run(["fetch", "--all", "--prune"], NET);
};

const pull: OpFn = async (ctx, [branch, mode, remote]: [string, "merge" | "rebase", string | undefined]) => {
  const { branch: cur } = await headInfo(ctx.root);
  if (branch !== cur) {
    await pullOther(ctx, branch, mode, remote);
    return;
  }
  const up = await upstreamOf(ctx.root, "HEAD");
  const rebase = mode === "rebase" ? "--rebase" : "--no-rebase";
  if (up && (!remote || remote === up)) {
    await runOrStop(ctx, ["pull", rebase], NET);
  } else {
    const [rname, ...rest] = (remote || `origin/${branch}`).split("/");
    await runOrStop(ctx, ["pull", rebase, rname, rest.join("/")], NET);
  }
};

/**
 * 체크아웃하지 않은 브랜치에 pull: 원격을 받은 뒤 작업 폴더를 건드리지 않고 브랜치만 옮긴다.
 * 앞으로 감기면 update-ref, 갈라졌으면 merge-tree + commit-tree 로 merge(또는 rebase) 결과를 메모리에서 만든다.
 * upstream 이 없거나 · 다른 worktree 에 체크아웃돼 있거나 · 충돌이 나면 아무것도 바꾸지 않고 거절한다.
 */
async function pullOther(ctx: OpContext, branch: string, mode: "merge" | "rebase", remote: string | undefined): Promise<void> {
  const { root } = ctx;
  const up = remote || (await upstreamOf(root, branch));
  if (!up) throw new Error(t("m.pullNoUpstream", { branch }));
  const wts = await git(root, ["worktree", "list", "--porcelain"]);
  if (wts.split("\n").includes(`branch refs/heads/${branch}`)) throw new Error(t("m.pullWorktree", { branch }));
  const [rname] = up.split("/");
  await ctx.run(["fetch", rname], NET);
  const local = await rev(root, `refs/heads/${branch}`);
  const theirs = await rev(root, up);
  const isAnc = async (a: string, b: string) => (await gitRaw(root, ["merge-base", "--is-ancestor", a, b])).code === 0;
  if (await isAnc(theirs, local)) return; // 받을 것 없음
  let next: string;
  if (await isAnc(local, theirs)) {
    next = theirs;
    ctx.note(`git fetch ${rname} && git branch -f ${branch} ${up}  # ${t("m.n.pullFf", { branch })}`);
  } else {
    if ((await git(root, ["config", "--get", "pull.ff"], { allowFail: true }) || "").trim() === "only") throw new Error(t("m.pullFfOnly", { branch }));
    if (mode === "rebase") {
      const base = (await git(root, ["merge-base", local, theirs])).trim();
      next = (await chain(root, theirs, (await firstParentRange(root, base, local)).map((id) => ({ id })))) ?? theirs;
      ctx.note(`git rebase ${up} ${branch}  # ${t("m.n.pullOther", { branch })}`);
    } else {
      const r = await gitRaw(root, ["merge-tree", "--write-tree", "--name-only", "--no-messages", local, theirs]);
      const lines = r.stdout.split("\n");
      if (r.code === 1) throw conflictError(lines.slice(1).filter(Boolean), `${up} → ${branch}`);
      if (r.code !== 0) throw new Error(r.stderr.trim() || t("m.mergeTree"));
      const msg = `Merge remote-tracking branch '${up}' into ${branch}`;
      next = await commitTree(root, lines[0].trim(), [local, theirs], msg);
      ctx.note(`git merge ${up}  # ${t("m.n.pullOther", { branch })} (${short(next)})`);
    }
  }
  await backup(root, `pull-${branch}`, local);
  await git(root, ["update-ref", `refs/heads/${branch}`, next, local]);
}

const push: OpFn = async (ctx, [branch]: [string]) => {
  const up = await upstreamOf(ctx.root, branch);
  const force = [...(ctx.extra.force ? ["--force-with-lease"] : []), ...(await verifyArgs(ctx.root))];
  if (up) {
    const [rname, ...rest] = up.split("/");
    await withHooks(ctx.root, ["pre-push"], () => ctx.run(["push", ...force, rname, `${branch}:${rest.join("/")}`], NET));
    return;
  }
  const remotes = (await git(ctx.root, ["remote"])).split("\n").filter(Boolean);
  if (!remotes.length) {
    const e: OpError = new Error(t("m.noRemote"));
    e.code = "NO_REMOTE";
    throw e;
  }
  await withHooks(ctx.root, ["pre-push"], () => ctx.run(["push", ...force, "-u", remotes.includes("origin") ? "origin" : remotes[0], branch], NET));
};

const remoteAdd: OpFn = async (ctx, [name, url]: [string, string]) => {
  await ctx.run(["remote", "add", name, url]);
  await ctx.run(["fetch", name], NET);
};
const remoteSetUrl: OpFn = async (ctx, [name, url]: [string, string]) => {
  await ctx.run(["remote", "set-url", name, url]);
};
const remoteRemove: OpFn = async (ctx, [name]: [string]) => {
  await ctx.run(["remote", "remove", name]);
};

/**
 * PR 받아 보기: 원격의 pull/<번호>/head 를 받아 로컬 브랜치 pr/<번호> 로 만들고 체크아웃.
 * 이미 있으면 새 커밋만 앞으로 감기 (로컬에서 따로 고친 게 있으면 덮어쓰지 않고 멈춘다).
 */
const checkoutPull: OpFn = async (ctx, [num, remote]: [number, string]) => {
  if (!Number.isInteger(num) || num <= 0) throw new Error(t("m.badPr"));
  if (!/^[\w.-]+$/.test(remote)) throw new Error(t("m.badRemote", { remote }));
  const branch = `pr/${num}`;
  await ctx.run(["fetch", remote, `pull/${num}/head`], NET);
  const exists = (await git(ctx.root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`], { allowFail: true })) !== null;
  const { branch: current } = await headInfo(ctx.root);
  if (!exists) {
    await ctx.run(["switch", "-c", branch, "FETCH_HEAD"]);
    return;
  }
  if (current !== branch) await ctx.run(["switch", branch]);
  try {
    await ctx.run(["merge", "--ff-only", "FETCH_HEAD"]);
  } catch {
    throw new Error(t("m.prDiverged", { branch }));
  }
};

export const remoteOps = {
  checkoutPull, fetch, pull, push, remoteAdd, remoteSetUrl, remoteRemove };
