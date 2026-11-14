// 원격 조작: fetch · pull · push · 원격 추가·주소 변경·삭제
import { git } from "@/git/cli";
import { runOrStop } from "@/git/ops/conflictOps";
import { NET, headInfo, unsupported, upstreamOf, type OpError, type OpFn } from "@/git/ops/context";

const fetch: OpFn = async (ctx) => {
  await ctx.run(["fetch", "--all", "--prune"], NET);
};

const pull: OpFn = async (ctx, [branch, mode, remote]: [string, "merge" | "rebase", string | undefined]) => {
  const { branch: cur } = await headInfo(ctx.root);
  if (branch !== cur) unsupported("체크아웃하지 않은 브랜치에 pull 하기");
  const up = await upstreamOf(ctx.root, "HEAD");
  const rebase = mode === "rebase" ? "--rebase" : "--no-rebase";
  if (up && (!remote || remote === up)) {
    await runOrStop(ctx, ["pull", rebase], NET);
  } else {
    const [rname, ...rest] = (remote || `origin/${branch}`).split("/");
    await runOrStop(ctx, ["pull", rebase, rname, rest.join("/")], NET);
  }
};

const push: OpFn = async (ctx, [branch]: [string]) => {
  const up = await upstreamOf(ctx.root, branch);
  const force = ctx.extra.force ? ["--force-with-lease"] : [];
  if (up) {
    const [rname, ...rest] = up.split("/");
    await ctx.run(["push", ...force, rname, `${branch}:${rest.join("/")}`], NET);
    return;
  }
  const remotes = (await git(ctx.root, ["remote"])).split("\n").filter(Boolean);
  if (!remotes.length) {
    const e: OpError = new Error("연결된 원격 저장소가 없습니다. 원격 주소를 먼저 추가하세요.");
    e.code = "NO_REMOTE";
    throw e;
  }
  await ctx.run(["push", ...force, "-u", remotes.includes("origin") ? "origin" : remotes[0], branch], NET);
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
  if (!Number.isInteger(num) || num <= 0) throw new Error("PR 번호가 올바르지 않습니다.");
  if (!/^[\w.-]+$/.test(remote)) throw new Error(`원격 이름이 올바르지 않습니다: ${remote}`);
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
    throw new Error(`${branch} 에 PR 에 없는 로컬 커밋이 있어 최신 PR 로 앞으로 감을 수 없습니다. ${branch} 를 지우거나 이름을 바꾼 뒤 다시 받으세요.`);
  }
};

export const remoteOps = {
  checkoutPull, fetch, pull, push, remoteAdd, remoteSetUrl, remoteRemove };
