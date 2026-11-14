// 충돌로 멈추기 · 해결 · 계속 · 건너뛰기 · 중단
import fs from "node:fs";
import path from "node:path";
import { git } from "@/git/cli";
import { readOpKind, recordConflicts, gitDir, SPLIT_FILE } from "@/git/opState";
import { unmergedFiles } from "@/git/status";
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
      ctx.warn(`충돌로 멈췄습니다 (${files.join(", ")}). 오른쪽 패널에서 해결한 뒤 위 배너의 계속을 누르세요.`);
      return true;
    }
    throw err;
  }
}

/** choice: ours(A 쪽) · theirs(B 쪽) · both(에디터에서 직접 고치기 → 다시 누르면 해결 완료) */
const resolveFile: OpFn = async (ctx, [file, choice]: [string, "ours" | "theirs" | "both"]) => {
  const { root } = ctx;
  const unmerged = await unmergedFiles(root);
  if (!unmerged.includes(file) && !(choice === "both" && hasMarkers(root, file))) {
    throw new Error(`${file} 은(는) 충돌 중인 파일이 아닙니다.`);
  }
  if (choice === "both") {
    if (hasMarkers(root, file)) {
      opener?.(path.join(root, file));
      ctx.warn(`${file} 을(를) 에디터로 열었습니다. <<<<<<< ======= >>>>>>> 표시를 정리하고 저장한 뒤 다시 "직접 편집" 을 누르면 해결로 표시합니다.`);
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
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`저장소 밖의 경로입니다: ${file}`);
  return full;
}

/** 앱의 충돌 편집기에서 고른 내용으로 파일을 쓰고 해결로 표시 */
const resolveContent: OpFn = async (ctx, [file, text]: [string, string]) => {
  const full = insideRoot(ctx.root, file);
  if (/^(<{7}|>{7}) /m.test(text)) throw new Error("아직 충돌 표시(<<<<<<< / >>>>>>>)가 남아 있습니다. 모든 충돌 구간을 고른 뒤 저장하세요.");
  fs.writeFileSync(full, text);
  ctx.note(`# ${file} 을(를) 충돌 편집기에서 고른 내용으로 저장`);
  await ctx.run(["add", "--", file]);
};

const continueOp: OpFn = async (ctx) => {
  const { root } = ctx;
  const left = await unmergedFiles(root);
  if (left.length) throw new Error(`아직 해결하지 않은 파일이 있습니다: ${left.join(", ")}`);
  const kind = readOpKind(root);
  const staged = ((await git(root, ["diff", "--cached", "--name-only", "-z"], { allowFail: true })) || "").split("\0");
  const marker = staged.filter((f) => f && hasMarkers(root, f));
  if (marker.length) throw new Error(`충돌 표시(<<<<<<<)가 남아 있는 파일이 있습니다: ${marker.join(", ")}`);
  if (kind === "rebase") {
    // 커밋 분할 중이면 남은 변경이 없어야 계속할 수 있다
    const g = await gitDir(root);
    if (fs.existsSync(path.join(g, SPLIT_FILE))) {
      const dirty = ((await git(root, ["status", "--porcelain"], { allowFail: true })) || "").trim();
      if (dirty) throw new Error("아직 커밋하지 않은 변경이 있습니다. 남은 변경을 커밋하거나 stage 해서 커밋한 뒤 계속하세요.");
      fs.rmSync(path.join(g, SPLIT_FILE), { force: true });
    }
    await runOrStop(ctx, ["rebase", "--continue"]);
  } else if (kind === "merge") await ctx.run(["commit", "--no-edit"]);
  else if (kind === "cherry-pick") await runOrStop(ctx, ["cherry-pick", "--continue"]);
  else if (kind === "revert") await runOrStop(ctx, ["revert", "--continue"]);
  // kind 가 없으면 (stash 충돌 등) 파일 정리만으로 끝
};

const skipOp: OpFn = async (ctx) => {
  const kind = readOpKind(ctx.root);
  if (kind === "rebase") await runOrStop(ctx, ["rebase", "--skip"]);
  else if (kind === "cherry-pick") await runOrStop(ctx, ["cherry-pick", "--skip"]);
  else throw new Error("건너뛸 수 있는 작업이 아닙니다.");
};

const abortOp: OpFn = async (ctx) => {
  const kind = readOpKind(ctx.root);
  if (kind === "rebase") {
    fs.rmSync(path.join(await gitDir(ctx.root), SPLIT_FILE), { force: true });
    await ctx.run(["rebase", "--abort"]);
  } else if (kind === "merge") await ctx.run(["merge", "--abort"]);
  else if (kind === "cherry-pick") await ctx.run(["cherry-pick", "--abort"]);
  else if (kind === "revert") await ctx.run(["revert", "--abort"]);
  else throw new Error("중단할 진행 중 작업이 없습니다. 충돌 파일은 A 쪽이나 B 쪽을 골라 정리하세요.");
};

export const conflictOps = { resolveFile, resolveContent, continueOp, skipOp, abortOp };
