// 패치 내보내기 · 적용: git format-patch (커밋 → 메일 형식 패치), git diff (커밋 안 한 변경), git am (메일 형식 → 커밋), git apply (diff → 작업 영역).
// 파일 경로는 main 의 저장·열기 창에서만 받는다 (repoIpc 가 repo:run 으로 오는 이 조작들은 거절한다).
import fs from "node:fs";
import path from "node:path";
import { git } from "@/git/cli";
import { readOpKind, recordConflicts } from "@/git/opState";
import { registerOps } from "@/git/ops/execute";
import { short, type OpContext, type OpFn } from "@/git/ops/context";
import { unmergedFiles } from "@/git/status";
import { t } from "@shared/i18n/i18n";
import type { PatchSource } from "@shared/types/ipc";

/** 고른 커밋을 오래된 것부터 (format-patch 결과를 am 으로 차례대로 적용할 수 있게) */
async function oldestFirst(root: string, ids: string[]): Promise<string[]> {
  const out = (await git(root, ["log", "--no-walk=sorted", "--topo-order", "--format=%H", ...ids])) || "";
  return out.split("\n").filter(Boolean).reverse();
}

/** 패치 본문. commits: 커밋마다 format-patch 를 이어 붙인 mbox · staged: git diff --cached · working: git diff HEAD (staged + unstaged) */
export async function patchText(ctx: OpContext, source: PatchSource, ids: string[] = []): Promise<string> {
  let text = "";
  if (source === "commits") {
    if (!ids.length) throw new Error(t("m.patchEmpty"));
    for (const id of await oldestFirst(ctx.root, ids)) {
      // merge 커밋은 format-patch 가 건너뛴다 (부모가 둘이라 메일 한 통으로 표현할 수 없다)
      const one = await ctx.run(["format-patch", "-1", "--stdout", "--binary", id]);
      if (!one.trim()) ctx.warn(t("m.patchSkippedMerge", { commit: short(id) }));
      text += one;
    }
  } else {
    const hasHead = !!((await git(ctx.root, ["rev-parse", "-q", "--verify", "HEAD"], { allowFail: true })) || "").trim();
    text = await ctx.run(source === "staged" || !hasHead ? ["diff", "--cached", "--binary"] : ["diff", "HEAD", "--binary"]);
  }
  if (!text.trim()) throw new Error(t("m.patchEmpty"));
  return text;
}

/** 패치 파일로 저장 (dest 는 저장 창에서 고른 경로) */
const patchExport: OpFn = async (ctx, [source, ids, dest]: [PatchSource, string[], string]) => {
  const text = await patchText(ctx, source, ids);
  fs.writeFileSync(dest, text);
  ctx.note(`# > ${JSON.stringify(dest)}`);
};

/** 메일 형식 (format-patch 결과 · mbox) 인가: 맨 앞 "From <해시>" 줄 또는 From:/Subject: 머리 */
export function isMailPatch(text: string): boolean {
  const head = text.slice(0, 4000);
  return /^From [0-9a-f]{40} /.test(head) || (/^From: /m.test(head) && /^Subject: /m.test(head) && head.indexOf("From: ") < head.search(/^(diff --git|---) /m));
}

/** git am 이 실패했을 때: 충돌이면 배너로 멈추고, 아니면 am 을 취소해 원래대로 둔 뒤 알린다 */
async function amOrStop(ctx: OpContext, args: string[]): Promise<void> {
  try {
    await ctx.run(args);
  } catch (err) {
    if ((await unmergedFiles(ctx.root)).length) {
      const files = await recordConflicts(ctx.root);
      ctx.warn(t("m.stopped", { files: files.join(", ") }));
      return;
    }
    const e = err as { stderr?: string; message: string };
    if (readOpKind(ctx.root) === "am") await ctx.run(["am", "--abort"]);
    throw new Error(t("m.patchFailed", { error: (e.stderr || e.message).trim() }));
  }
}

/** 패치 적용 (file 은 열기 창에서 고른 경로).
 * 메일 형식 → git am --3way: 커밋이 생기고 브랜치가 움직이므로 ⌘Z 로 되돌릴 수 있다. 충돌이면 진행 중 배너 (am --continue · --skip · --abort).
 * 그냥 diff → git apply: 작업 영역만 바뀐다 (⌘Z 대상 아님, git apply -R 로 되돌린다). 그대로 안 맞으면 --3way 로 충돌을 남긴다. */
const patchApply: OpFn = async (ctx, [file]: [string]) => {
  if (readOpKind(ctx.root)) throw new Error(t("act.blocked"));
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) throw new Error(t("m.patchEmpty"));
  if (isMailPatch(text)) {
    await amOrStop(ctx, ["am", "--3way", file]);
    return;
  }
  try {
    await ctx.run(["apply", "--check", file]);
  } catch (err) {
    // 그대로는 안 맞는다: 3-way 로 시도 (패치에 적힌 원본 blob 이 저장소에 있어야 한다)
    try {
      await ctx.run(["apply", "--3way", file]);
    } catch (err3) {
      if ((await unmergedFiles(ctx.root)).length) {
        const files = await recordConflicts(ctx.root);
        ctx.warn(t("m.stopped", { files: files.join(", ") }));
        return;
      }
      const e = (err3 as { stderr?: string }).stderr || (err as { stderr?: string; message: string }).stderr || (err as Error).message;
      throw new Error(t("m.patchFailed", { error: e.trim() }));
    }
    ctx.note(`# ${t("m.patchApplyUndo", { file: path.basename(file) })}`);
    return;
  }
  await ctx.run(["apply", file]);
  ctx.note(`# ${t("m.patchApplyUndo", { file: path.basename(file) })}`);
};

export function registerPatchOps(): void {
  registerOps({ patchExport, patchApply });
}
