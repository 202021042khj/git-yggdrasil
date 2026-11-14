// 태그 · 과거 커밋 체크아웃 · upstream · 원격 브랜치 삭제 · 부분 stage · 커밋 분할
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "@/git/cli";
import { gitDir, readOpKind, SPLIT_FILE } from "@/git/opState";
import { registerOps } from "@/git/ops/execute";
import { commitInfo } from "@/git/ops/historyOps";
import { NET, backup, headInfo, short, type OpFn } from "@/git/ops/context";
import { parseDiff, patchFor } from "@/git/patch";

// ---------- 태그 ----------
const tagCreate: OpFn = async (ctx, [name, id, message]: [string, string, string | undefined]) => {
  if (message) await ctx.run(["tag", "-a", name, "-m", message, id]);
  else await ctx.run(["tag", name, id]);
};

const tagMove: OpFn = async (ctx, [name, id]: [string, string]) => {
  // 주석 태그면 메시지를 유지한 채 다시 만든다
  const type = ((await git(ctx.root, ["cat-file", "-t", `refs/tags/${name}`], { allowFail: true })) || "").trim();
  if (type === "tag") {
    const msg = ((await git(ctx.root, ["for-each-ref", "--format=%(contents)", `refs/tags/${name}`])) || "").trim();
    await ctx.run(["tag", "-f", "-a", name, "-m", msg || name, id]);
  } else await ctx.run(["tag", "-f", name, id]);
};

const tagDelete: OpFn = async (ctx, [name]: [string]) => {
  await ctx.run(["tag", "-d", name]);
};

/** 태그를 원격에 올린다. 옮긴 태그면 덮어쓰기(--force)가 필요하다 */
const tagPush: OpFn = async (ctx, [name, remote]: [string, string | undefined]) => {
  const target = remote || "origin";
  await ctx.run(["push", ...(ctx.extra.force ? ["--force"] : []), target, `refs/tags/${name}`], NET);
};

// ---------- 과거 커밋 체크아웃 (detached HEAD) ----------
const checkoutCommit: OpFn = async (ctx, [id]: [string]) => {
  await ctx.run(["switch", "--detach", id]);
  ctx.warn(`${short(id)} 를 임시로 체크아웃했습니다 (어느 브랜치에도 속하지 않은 상태). 여기서 커밋하려면 먼저 새 브랜치를 만드세요.`);
};

// ---------- upstream · 원격 브랜치 ----------
const setUpstream: OpFn = async (ctx, [branch, remoteBranch]: [string, string]) => {
  if (remoteBranch) await ctx.run(["branch", `--set-upstream-to=${remoteBranch}`, branch]);
  else await ctx.run(["branch", "--unset-upstream", branch]);
};

const deleteRemoteBranch: OpFn = async (ctx, [remoteBranch]: [string]) => {
  const [remote, ...rest] = remoteBranch.split("/");
  try {
    await ctx.run(["push", remote, "--delete", rest.join("/")], NET);
  } catch (err) {
    if (/refusing to delete the current branch|default branch/i.test((err as { stderr?: string }).stderr || "")) {
      throw new Error(`${remoteBranch} 는 원격의 기본 브랜치라 지울 수 없습니다. GitHub 저장소 설정에서 기본 브랜치를 바꾼 뒤 지우세요.`);
    }
    throw err;
  }
};

// ---------- 부분 stage (hunk 단위) ----------
/** staged=false: 변경 덩어리 하나를 stage, staged=true: stage 된 덩어리 하나를 unstage */
/** hunk 하나, 또는 그 안의 고른 줄만 stage / unstage (lines: hunk.lines 안의 번호) */
const stageHunk: OpFn = async (ctx, [file, index, staged, lines]: [string, number, boolean, number[]?]) => {
  const diff = await git(ctx.root, ["diff", "--no-color", ...(staged ? ["--cached"] : []), "--", file]);
  const patch = patchFor(parseDiff(diff), index, lines?.length ? lines : undefined, staged);
  const tmp = path.join(os.tmpdir(), `ygg-hunk-${process.pid}-${Date.now()}.patch`);
  fs.writeFileSync(tmp, patch);
  try {
    await ctx.run(["apply", "--cached", ...(lines?.length ? ["--recount"] : []), ...(staged ? ["-R"] : []), "--", tmp]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
};

// ---------- 커밋 분할 ----------
// 커밋의 변경을 작업 영역으로 풀어 놓고, 사용자가 부분 stage 로 나눠 커밋한 뒤 "계속" 하면 뒤 커밋을 다시 올린다.
const splitCommit: OpFn = async (ctx, [id]: [string]) => {
  const { root } = ctx;
  const { branch, tip } = await headInfo(root);
  if (!branch) throw new Error("브랜치를 체크아웃한 상태에서만 커밋을 나눌 수 있습니다.");
  if ((await git(root, ["status", "--porcelain"])).trim()) throw new Error("작업 영역에 변경이 있습니다. 먼저 커밋하거나 stash 한 뒤 나누세요.");
  const isAnc = await git(root, ["merge-base", "--is-ancestor", id, "HEAD"], { allowFail: true });
  if (isAnc === null) throw new Error(`현재 브랜치(${branch})에 있는 커밋만 나눌 수 있습니다.`);
  const c = await commitInfo(root, id);
  if (c.parents.length !== 1) throw new Error("merge 커밋이나 첫 커밋은 나눌 수 없습니다.");
  const files = ((await git(root, ["show", "--format=", "--name-only", id])) || "").split("\n").filter(Boolean);
  await backup(root, `split-${branch}`, tip);
  const marker = { msg: c.msg.split("\n")[0], files };

  if (id === tip) {
    // 끝 커밋: rebase 없이 풀어 놓기만 하면 된다 (진행 중 상태가 아니므로 바로 나눠 커밋하면 끝)
    await ctx.run(["reset", "--mixed", "HEAD~1"]);
    ctx.warn(`"${marker.msg}" 의 변경을 작업 영역으로 풀었습니다. 파일이나 변경 덩어리를 골라 여러 번에 나눠 커밋하세요.`);
    return;
  }
  // 과거 커밋: 그 커밋에서 멈추는 rebase (pick → edit) 를 시작한 뒤 커밋을 풀어 놓는다
  const s7 = short(id);
  const editor = `sed -i.ygg -e 's/^pick ${s7}/edit ${s7}/'`;
  await ctx.run(["rebase", "-i", `${id}~1`], { env: { GIT_SEQUENCE_EDITOR: editor } });
  if (readOpKind(root) !== "rebase") throw new Error("커밋 분할을 시작하지 못했습니다.");
  await ctx.run(["reset", "--mixed", "HEAD~1"]);
  fs.writeFileSync(path.join(await gitDir(root), SPLIT_FILE), JSON.stringify(marker));
  ctx.warn(`"${marker.msg}" 에서 멈췄습니다. 변경을 골라 여러 번에 나눠 커밋한 뒤 위 배너의 계속을 누르면 뒤 커밋을 다시 올립니다.`);
};

export function registerP3Ops(): void {
  registerOps({ tagCreate, tagMove, tagDelete, tagPush, checkoutCommit, setUpstream, deleteRemoteBranch, stageHunk, splitCommit });
}
