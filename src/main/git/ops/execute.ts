// 조작 등록부와 실행기. 화면은 { op, args, extra } 만 보내고, 여기서 실제 git 명령으로 바꿔 실행한다.
// 실행 전후의 브랜치 위치를 비교해 되돌리기(⌘Z) 기록을 남긴다.
import { git } from "@/git/cli";
import { branchOps } from "@/git/ops/branchOps";
import { conflictOps } from "@/git/ops/conflictOps";
import { createContext, headInfo, type OpError, type OpFn } from "@/git/ops/context";
import { historyOps } from "@/git/ops/historyOps";
import { remoteOps } from "@/git/ops/remoteOps";
import { workingOps } from "@/git/ops/workingOps";
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
}

const undoStacks = new Map<string, UndoEntry[]>();
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

/** 앱에서 한 조작 중 브랜치 위치를 바꾼 것을 하나씩 되돌린다 */
const undo: OpFn = async (ctx) => {
  const stack = undoStacks.get(ctx.root) || [];
  const last = stack.pop();
  if (!last) throw new Error("되돌릴 작업이 없습니다. (브랜치 위치를 바꾼 조작만 되돌릴 수 있습니다)");
  if (last.op === "renameBranch") { // 이름 변경은 이름만 되돌린다 (원격에 반영한 것은 그대로)
    await ctx.run(["branch", "-m", String(last.args[1]), String(last.args[0])]);
    ctx.note("# 되돌림: 브랜치 이름 변경 (원격은 그대로)");
    undoStacks.set(ctx.root, stack);
    return;
  }
  const now = await snapshot(ctx.root);
  if (last.before.head && now.head !== last.before.head && last.before.heads[last.before.head]) {
    await ctx.run(["switch", last.before.head]);
  }
  for (const b of new Set([...Object.keys(last.before.heads), ...Object.keys(last.after.heads)])) {
    const was = last.before.heads[b], is = last.after.heads[b];
    if (was === is) continue;
    const cur = await snapshot(ctx.root);
    if (!was) { // 조작으로 생긴 브랜치 → 지운다
      if (cur.head === b) throw new Error(`${b} 가 체크아웃되어 있어 지울 수 없습니다.`);
      await ctx.run(["branch", "-D", b]);
    } else if (cur.head === b) {
      await ctx.run(["reset", SOFT_UNDO.has(last.op) ? "--soft" : "--keep", was]);
    } else {
      await ctx.run(["branch", "-f", b, was]);
    }
  }
  ctx.note(`# 되돌림: ${last.op}`);
  undoStacks.set(ctx.root, stack);
};

export const OPS: Partial<Record<OpName, OpFn>> = {
  ...workingOps,
  ...branchOps,
  ...remoteOps,
  ...historyOps,
  ...conflictOps,
  undo,
};

/** 나중에 추가하는 조작 (P3 등) 을 등록 */
export function registerOps(ops: Partial<Record<OpName, OpFn>>): void {
  Object.assign(OPS, ops);
}

export async function execute(root: string, op: OpName, args: unknown[] = [], extra: OpExtra = {}): Promise<RunResult> {
  const fn = OPS[op];
  if (!fn) throw new Error(`알 수 없는 조작: ${op}`);
  const { ctx, cmds, warnings } = createContext(root, extra);
  const before = op === "undo" ? null : await snapshot(root).catch(() => null);
  try {
    await fn(ctx, args);
    if (before) {
      const after = await snapshot(root);
      if (JSON.stringify(after.heads) !== JSON.stringify(before.heads)) {
        const stack = undoStacks.get(root) || [];
        stack.push({ op, args, before, after });
        undoStacks.set(root, stack.slice(-UNDO_LIMIT));
      }
    }
    return { ok: true, cmds, warnings, undoable: (undoStacks.get(root) || []).length };
  } catch (e) {
    const err = e as OpError;
    return {
      ok: false,
      cmds,
      unsupported: !!err.unsupported,
      conflicts: err.conflicts,
      code: err.code === "NO_REMOTE" || err.code === "NEEDS_CHECKOUT" ? err.code : undefined,
      branch: err.branch,
      error: err.stderr || String(err.message || err),
    };
  }
}
