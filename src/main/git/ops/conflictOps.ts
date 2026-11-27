// 충돌로 멈추기 · 해결 · 계속 · 건너뛰기 · 중단
import fs from "node:fs";
import path from "node:path";
import { git } from "@/git/cli";
import { readOpKind, readStashMark, recordConflicts, gitDir, writeStashMark, SPLIT_FILE } from "@/git/opState";
import { unmergedFiles } from "@/git/status";
import { t } from "@shared/i18n/i18n";
import type { GitOptions } from "@/git/cli";
import type { OpContext, OpFn } from "@/git/ops/context";

/** 충돌 파일을 에디터로 여는 함수 (main 에서 shell.openPath 를 넣어 준다) */
let opener: ((file: string) => void) | null = null;
export function setOpener(fn: ((file: string) => void) | null): void {
  opener = fn;
}

const hasMarkers = (root: string, file: string) => {
  try { return /^(<{7}|>{7}) /m.test(fs.readFileSync(path.join(root, file), "utf8")); } catch { return false; }
};

/** 실제 git 명령을 실행하다 충돌로 멈추면, 실패가 아니라 "진행 중" 으로 남기고 알린다. 멈췄으면 true. */
export async function runOrStop(ctx: OpContext, args: string[], opts?: GitOptions): Promise<boolean> {
  try {
    await ctx.run(args, opts);
    return false;
  } catch (err) {
    if (readOpKind(ctx.root) || (await unmergedFiles(ctx.root)).length) {
      const files = await recordConflicts(ctx.root);
      ctx.warn(t("m.stopped", { files: files.join(", ") }));
      return true;
    }
    throw err;
  }
}

/** stash 목록 (최신부터) 의 커밋 해시와 메시지 */
export async function stashList(root: string): Promise<{ oid: string; msg: string }[]> {
  const out = (await git(root, ["log", "-g", "--format=%H%x1f%gs", "refs/stash"], { allowFail: true })) || "";
  return out.split("\n").filter(Boolean).map((l) => { const [oid, msg] = l.split("\x1f"); return { oid, msg }; });
}

/** 번호는 앞 stash 가 지워지면 밀리므로, 커밋 해시로 찾아 지운다. 못 찾으면 false. */
export async function dropStashByOid(ctx: OpContext, oid: string): Promise<boolean> {
  const list = await stashList(ctx.root);
  const i = list.findIndex((s) => s.oid === oid);
  if (i < 0) return false;
  await ctx.run(["stash", "drop", `stash@{${i}}`]);
  ctx.droppedStash = list[i];
  return true;
}

/** 지운 stash 커밋을 목록 맨 위에 다시 넣는다 (되돌리기) */
export async function storeStash(ctx: OpContext, s: { oid: string; msg: string }): Promise<void> {
  await ctx.run(["stash", "store", "-m", s.msg, s.oid]);
}

/** choice: ours(A 쪽) · theirs(B 쪽) · both(에디터에서 직접 고치기 → 다시 누르면 해결 완료) */
const resolveFile: OpFn = async (ctx, [file, choice]: [string, "ours" | "theirs" | "both"]) => {
  const { root } = ctx;
  const unmerged = await unmergedFiles(root);
  if (!unmerged.includes(file) && !(choice === "both" && hasMarkers(root, file))) {
    throw new Error(t("m.notConflicted", { file }));
  }
  if (choice === "both") {
    if (hasMarkers(root, file)) {
      opener?.(path.join(root, file));
      ctx.warn(t("m.openedEditor", { file }));
      return;
    }
    await ctx.run(["add", "--", file]);
    return;
  }
  try {
    await ctx.run(["checkout", `--${choice}`, "--", file]);
    await ctx.run(["add", "--", file]);
  } catch (err) {
    // 한쪽에서 지운 파일: 그쪽을 고르면 삭제가 해결이다
    if (/does not have (our|their) version/.test((err as { stderr?: string }).stderr || "")) await ctx.run(["rm", "-q", "--", file]);
    else throw err;
  }
};

/** 저장소 안의 파일 경로만 허용 (../ 로 밖을 가리키지 못하게) */
export function insideRoot(root: string, file: string): string {
  const full = path.resolve(root, file);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(t("m.outside", { path: file }));
  return full;
}

/** 앱의 충돌 편집기에서 고른 내용으로 파일을 쓰고 해결로 표시 */
const resolveContent: OpFn = async (ctx, [file, text]: [string, string]) => {
  const full = insideRoot(ctx.root, file);
  if (/^(<{7}|>{7}) /m.test(text)) throw new Error(t("m.markersLeft"));
  fs.writeFileSync(full, text);
  ctx.note(`# ${t("m.savedResolved", { file })}`);
  await ctx.run(["add", "--", file]);
};

const continueOp: OpFn = async (ctx) => {
  const { root } = ctx;
  const left = await unmergedFiles(root);
  if (left.length) throw new Error(t("m.unresolved", { files: left.join(", ") }));
  const kind = readOpKind(root);
  const staged = ((await git(root, ["diff", "--cached", "--name-only", "-z"], { allowFail: true })) || "").split("\0");
  const marker = staged.filter((f) => f && hasMarkers(root, f));
  if (marker.length) throw new Error(t("m.markersIn", { files: marker.join(", ") }));
  if (kind === "rebase") {
    // 커밋 분할 중이면 남은 변경이 없어야 계속할 수 있다
    const g = await gitDir(root);
    if (fs.existsSync(path.join(g, SPLIT_FILE))) {
      const dirty = ((await git(root, ["status", "--porcelain"], { allowFail: true })) || "").trim();
      if (dirty) throw new Error(t("m.uncommitted"));
      fs.rmSync(path.join(g, SPLIT_FILE), { force: true });
    }
    await runOrStop(ctx, ["rebase", "--continue"]);
  } else if (kind === "merge") await ctx.run(["commit", "--no-edit"]);
  else if (kind === "cherry-pick") await runOrStop(ctx, ["cherry-pick", "--continue"]);
  else if (kind === "revert") await runOrStop(ctx, ["revert", "--continue"]);
  else if (kind === "am") await runOrStop(ctx, ["am", "--continue"]);
  else {
    // kind 가 없으면 파일 정리만으로 끝. stash pop 충돌이었으면 git 이 남겨 둔 그 stash 를 지운다 (apply 였으면 그대로)
    const mark = await readStashMark(root);
    if (!mark) return;
    await writeStashMark(root, null);
    if (mark.keep) ctx.note(`# ${t("m.stashKept", { msg: mark.msg })}`);
    else if (!(await dropStashByOid(ctx, mark.oid))) ctx.warn(t("m.stashGone", { msg: mark.msg }));
  }
};

const skipOp: OpFn = async (ctx) => {
  const kind = readOpKind(ctx.root);
  if (kind === "rebase") await runOrStop(ctx, ["rebase", "--skip"]);
  else if (kind === "cherry-pick") await runOrStop(ctx, ["cherry-pick", "--skip"]);
  else if (kind === "am") await runOrStop(ctx, ["am", "--skip"]);
  else throw new Error(t("m.cantSkip"));
};

const abortOp: OpFn = async (ctx) => {
  const kind = readOpKind(ctx.root);
  if (kind === "rebase") {
    fs.rmSync(path.join(await gitDir(ctx.root), SPLIT_FILE), { force: true });
    await ctx.run(["rebase", "--abort"]);
  } else if (kind === "merge") await ctx.run(["merge", "--abort"]);
  else if (kind === "cherry-pick") await ctx.run(["cherry-pick", "--abort"]);
  else if (kind === "revert") await ctx.run(["revert", "--abort"]);
  else if (kind === "am") await ctx.run(["am", "--abort"]);
  else {
    const mark = await readStashMark(ctx.root);
    if (!mark) throw new Error(t("m.nothingToAbort"));
    // stash 를 적용하기 전으로: 적용한 변경(staged · 충돌)을 되돌리고, stash 가 되살린 추적 안 하는 파일은 지운다. stash 는 그대로 남는다
    await ctx.run(["reset", "--merge"]);
    const restored = ((await git(ctx.root, ["ls-tree", "-r", "-z", "--name-only", `${mark.oid}^3`], { allowFail: true })) || "").split("\0").filter(Boolean);
    if (restored.length) await ctx.run(["clean", "-f", "-q", "--", ...restored]);
    await writeStashMark(ctx.root, null);
    ctx.note(`# ${t("m.stashKept", { msg: mark.msg })}`);
  }
};

export const conflictOps = { resolveFile, resolveContent, continueOp, skipOp, abortOp };
