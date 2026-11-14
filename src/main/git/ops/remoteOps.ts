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

export const remoteOps = { fetch, pull, push, remoteAdd, remoteSetUrl, remoteRemove };
