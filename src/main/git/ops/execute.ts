// 조작 등록부와 실행기. 화면은 { op, args, extra } 만 보내고, 여기서 실제 git 명령으로 바꿔 실행한다.
// 실행 전후의 브랜치 위치를 비교해 되돌리기(⌘Z) 기록을 남긴다.
import { git } from "@/git/cli";
import { branchOps } from "@/git/ops/branchOps";
import { conflictOps, dropStashByOid, storeStash } from "@/git/ops/conflictOps";
import { createContext, headInfo, redoFile, undoFile, type FileUndo, type OpError, type OpFn } from "@/git/ops/context";
import { authUrlFromError } from "@/git/credential";
import { explainRemoteError } from "@/git/remoteErrors";
import { historyOps } from "@/git/ops/historyOps";
import { bisecting } from "@/git/opState";
import { remoteOps } from "@/git/ops/remoteOps";
import { workingOps } from "@/git/ops/workingOps";
import { t } from "@shared/i18n/i18n";
import type { OpExtra, OpName, RunResult } from "@shared/types/ipc";

interface Snapshot {
  heads: Record<string, string>;
  head: string | null;
}

interface UndoEntry {
  op: OpName;
  args: unknown[];
  before: Snapshot;
  after: Snapshot;
  /** 지운 stash (되돌리면 git stash store 로 되살리고, 다시 실행하면 해시로 찾아 다시 지운다) */
  stash?: { oid: string; msg: string };
  /** 바꾼 파일 (.gitignore 등). 되돌리면 이전 내용을 되쓴다 */
  file?: FileUndo;
}

const undoStacks = new Map<string, UndoEntry[]>();
const redoStacks = new Map<string, UndoEntry[]>();
const UNDO_LIMIT = 50;
/** 커밋류는 되돌려도 변경 내용을 Staged 로 남긴다. 나머지는 작업 영역까지 이전 상태로. */
const SOFT_UNDO = new Set<OpName>(["commitTo", "amendInto", "reword"]);

async function snapshot(root: string): Promise<Snapshot> {
  // for-each-ref 는 %x1f 표기를 모르므로 실제 구분 문자를 넣는다
  const out = await git(root, ["for-each-ref", "--format=%(refname:short)\x1f%(objectname)", "refs/heads"]);
  const heads: Record<string, string> = {};
  out.split("\n").filter(Boolean).forEach((l) => {
    const [b, o] = l.split("\x1f");
    heads[b] = o;
  });
  return { heads, head: (await headInfo(root)).branch };
}

/** 브랜치 위치를 from 상태에서 to 상태로 옮긴다 (되돌리기·다시 실행 공용) */
async function restore(ctx: Parameters<OpFn>[0], entry: UndoEntry, from: Snapshot, to: Snapshot): Promise<void> {
  const now = await snapshot(ctx.root);
  if (to.head && now.head !== to.head && (to.heads[to.head] && now.heads[to.head])) await ctx.run(["switch", to.head]);
  for (const b of new Set([...Object.keys(from.heads), ...Object.keys(to.heads)])) {
    const was = from.heads[b], want = to.heads[b];
    if (was === want) continue;
    const cur = await snapshot(ctx.root);
    if (!want) { // to 상태에는 없는 브랜치 → 지운다
      if (cur.head === b) throw new Error(t("m.deleteCheckedOut", { branch: b }));
      await ctx.run(["branch", "-D", b]);
    } else if (cur.head === b) {
      await ctx.run(["reset", SOFT_UNDO.has(entry.op) ? "--soft" : "--keep", want]);
    } else {
      await ctx.run(["branch", "-f", b, want]);
    }
  }
  // 새로 생긴 브랜치로 체크아웃해야 하는 경우 (예: 다시 실행한 switchCreate)
  const end = await snapshot(ctx.root);
  if (to.head && end.head !== to.head && end.heads[to.head]) await ctx.run(["switch", to.head]);
}

const stackOf = (m: Map<string, UndoEntry[]>, root: string) => { if (!m.has(root)) m.set(root, []); return m.get(root)!; };

/** 앱에서 한 조작 중 브랜치 위치를 바꾼 것을 하나씩 되돌린다 */
const undo: OpFn = async (ctx) => {
  const stack = stackOf(undoStacks, ctx.root);
  const last = stack.at(-1);
  if (!last) throw new Error(t("m.noUndo"));
  // bisect 중에는 HEAD 가 bisect 것이라 브랜치를 옮기면 꼬인다. 빠져나오는 길은 bisect reset
  if (await bisecting(ctx.root)) throw new Error(t("m.bisectUndo"));
  if (last.file) { // 파일만 바꾼 조작 (무시 패턴)
    await undoFile(ctx, last.file);
  } else if (last.op === "renameBranch") { // 이름 변경은 이름만 되돌린다 (원격에 반영한 것은 그대로)
    await ctx.run(["branch", "-m", String(last.args[1]), String(last.args[0])]);
    ctx.note(`# ${t("m.undoRename")}`);
  } else {
    await restore(ctx, last, last.after, last.before);
    if (last.stash) await storeStash(ctx, last.stash);
    ctx.note(`# ${t("m.undoOp", { op: last.op })}`);
  }
  stack.pop();
  stackOf(redoStacks, ctx.root).push(last);
};

/** 되돌린 조작을 다시 적용한다 (조작 때의 결과 커밋으로 브랜치를 되돌려 놓는다) */
const redo: OpFn = async (ctx) => {
  const stack = stackOf(redoStacks, ctx.root);
  const next = stack.at(-1);
  if (!next) throw new Error(t("top.noRedo"));
  if (await bisecting(ctx.root)) throw new Error(t("m.bisectUndo"));
  if (next.file) {
    await redoFile(ctx, next.file);
  } else if (next.op === "renameBranch") {
    await ctx.run(["branch", "-m", String(next.args[0]), String(next.args[1])]);
    ctx.note(`# ${t("m.redoRename")}`);
  } else {
    await restore(ctx, next, next.before, next.after);
    if (next.stash && !(await dropStashByOid(ctx, next.stash.oid))) throw new Error(t("m.stashGone", { msg: next.stash.msg }));
    ctx.note(`# ${t("m.redoOp", { op: next.op })}`);
  }
  stack.pop();
  stackOf(undoStacks, ctx.root).push(next);
};

export const OPS: Partial<Record<OpName, OpFn>> = {
  ...workingOps,
  ...branchOps,
  ...remoteOps,
  ...historyOps,
  ...conflictOps,
  undo,
  redo,
};

/** 나중에 추가하는 조작 (태그·부분 stage 등) 을 등록 */
export function registerOps(ops: Partial<Record<OpName, OpFn>>): void {
  Object.assign(OPS, ops);
}

/** git commit 이 서명에 실패한 경우 (gpg-agent·ssh-agent 없음, pinentry 를 띄울 수 없음 등) 안내 */
function signHint(text: string | undefined): RunResult["hint"] | null {
  return text && /gpg failed to sign|failed to sign|signing failed|error: (?:gpg|ssh-keygen)|Couldn't (?:load|find) (?:public )?key/i.test(text)
    ? { title: t("m.signHint.title"), fix: t("m.signHint.fix") } : null;
}

/** hook 이 막은 경우 안내 (앱이 직접 돌린 hook, 또는 git commit/push 가 돌린 hook) */
function hookHint(err: OpError & { hook?: string }): RunResult["hint"] | null {
  const text = err.stderr || err.message || "";
  return err.hook || /hook (?:declined|failed)|pre-commit hook|commit-msg hook|pre-push hook|husky - /i.test(text)
    ? { title: t("m.hookHint.title"), fix: t("m.hookHint.fix") } : null;
}

export async function execute(root: string, op: OpName, args: unknown[] = [], extra: OpExtra = {}): Promise<RunResult> {
  const fn = OPS[op];
  if (!fn) throw new Error(t("m.unknownOp", { op }));
  const { ctx, cmds, warnings } = createContext(root, extra);
  const before = op === "undo" || op === "redo" ? null : await snapshot(root).catch(() => null);
  try {
    await fn(ctx, args);
    if (before) {
      const after = await snapshot(root);
      if (JSON.stringify(after.heads) !== JSON.stringify(before.heads) || ctx.droppedStash || ctx.fileUndo) {
        const stack = undoStacks.get(root) || [];
        stack.push({ op, args, before, after, stash: ctx.droppedStash, file: ctx.fileUndo });
        undoStacks.set(root, stack.slice(-UNDO_LIMIT));
        redoStacks.set(root, []); // 새 조작을 하면 다시 실행 기록은 버린다
      }
    }
    return { ok: true, cmds, warnings, undoable: (undoStacks.get(root) || []).length, redoable: (redoStacks.get(root) || []).length };
  } catch (e) {
    const err = e as OpError;
    const authUrl = authUrlFromError(err.stderr || err.message);
    return {
      ok: false,
      cmds,
      unsupported: !!err.unsupported,
      conflicts: err.conflicts,
      code: err.code === "NO_REMOTE" || err.code === "NEEDS_CHECKOUT" ? err.code : authUrl ? "AUTH_REQUIRED" : undefined,
      authUrl: authUrl ?? undefined,
      branch: err.branch,
      error: err.stderr || String(err.message || err),
      hint: hookHint(err) ?? explainRemoteError(err.stderr || err.message) ?? signHint(err.stderr || err.message) ?? undefined,
    };
  }
}
