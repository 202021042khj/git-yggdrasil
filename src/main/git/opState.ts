// 진행 중인 작업 (rebase · merge · cherry-pick · revert 가 충돌이나 편집으로 멈춘 상태)을 .git 에서 읽는다
import fs from "node:fs";
import path from "node:path";
import { git } from "@/git/cli";
import { readStatus } from "@/git/status";
import { t } from "@shared/i18n/i18n";
import type { OpKind, OpState } from "@shared/types/repo";

/** 앱이 멈춘 시점의 충돌 파일 목록 (해결한 파일을 ✓ 로 보여 주려고 남긴다) */
const CONFLICT_FILE = "ygg-conflicts.json";
/** 커밋 분할 중이라는 표시 (rebase 의 edit 로 멈춘 것과 구분) */
export const SPLIT_FILE = "ygg-split.json";

export async function gitDir(root: string): Promise<string> {
  const d = ((await git(root, ["rev-parse", "--git-dir"], { allowFail: true })) || ".git").trim();
  return path.isAbsolute(d) ? d : path.join(root, d);
}

/** 진행 중인 작업 종류만 빠르게 */
export function readOpKind(root: string): Exclude<OpKind, "files" | "stash" | "split"> | null {
  const g = path.join(root, ".git");
  const has = (f: string) => fs.existsSync(path.join(g, f));
  if (has("rebase-merge") || has("rebase-apply")) return "rebase";
  if (has("MERGE_HEAD")) return "merge";
  if (has("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (has("REVERT_HEAD")) return "revert";
  return null;
}

const readText = (f: string) => {
  try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; }
};
const subjectOf = async (root: string, rev: string) =>
  ((await git(root, ["show", "-s", "--format=%s", rev], { allowFail: true })) || "").trim();
const branchAt = async (root: string, oid: string) =>
  ((await git(root, ["for-each-ref", "--points-at", oid, "--format=%(refname:short)", "refs/heads"], { allowFail: true })) || "")
    .split("\n").filter(Boolean)[0];

type OpBase = Omit<OpState, "conflicts" | "resolved">;

/** 화면의 state.op 모양으로 돌려준다 */
export async function readOpState(root: string, unmerged: string[], head: string | null): Promise<OpState | null> {
  const g = await gitDir(root);
  const has = (f: string) => fs.existsSync(path.join(g, f));
  let op: OpBase | null = null;

  if (has("rebase-merge") || has("rebase-apply")) {
    const dir = path.join(g, has("rebase-merge") ? "rebase-merge" : "rebase-apply");
    const branch = readText(path.join(dir, "head-name")).replace(/^refs\/heads\//, "");
    const onto = readText(path.join(dir, "onto"));
    const ontoName = (onto && (await branchAt(root, onto))) || (onto ? onto.slice(0, 7) : t("os.target"));
    const step = Number(readText(path.join(dir, "msgnum")) || readText(path.join(dir, "next")) || 1);
    const total = Number(readText(path.join(dir, "end")) || readText(path.join(dir, "last")) || step);
    const cur = has("REBASE_HEAD") ? await subjectOf(root, "REBASE_HEAD") : "";
    const tip = ((await git(root, ["rev-parse", "-q", "--verify", "HEAD"], { allowFail: true })) || "").trim();
    let split: { msg: string; files: string[] } | null = null;
    try { split = JSON.parse(fs.readFileSync(path.join(g, SPLIT_FILE), "utf8")); } catch { split = null; }
    if (split && !unmerged.length) {
      // 커밋 분할: rebase 가 그 커밋에서 멈춰 있고, 커밋의 변경은 작업 영역에 풀려 있다
      op = { kind: "split", branch, title: t("ctx.splitSummary", { msg: split.msg }), step: Math.max(0, step - 1), total,
        current: { msg: split.msg, files: split.files }, tip, oursName: "", theirsName: "" };
    } else {
      op = { kind: "rebase", branch, title: t("os.rebase", { branch, onto: ontoName }), step: Math.max(0, step - 1), total,
        current: { msg: cur || t("os.currentCommit") }, tip, oursName: t("os.ontoSide", { name: ontoName }), theirsName: t("os.applying", { msg: cur }) };
    }
  } else if (has("MERGE_HEAD")) {
    const msg = readText(path.join(g, "MERGE_MSG")).split("\n")[0];
    const from = (msg.match(/^Merge (?:remote-tracking )?branch '([^']+)'/) || [])[1] || t("os.incoming");
    op = { kind: "merge", title: msg || "merge", oursName: t("os.current", { name: head || "HEAD" }), theirsName: from };
  } else if (has("CHERRY_PICK_HEAD")) {
    const cur = await subjectOf(root, "CHERRY_PICK_HEAD");
    const todo = readText(path.join(g, "sequencer", "todo")).split("\n").filter((l) => /^\w/.test(l)).length;
    op = { kind: "cherry-pick", title: t("os.cherryPick", { branch: head || "HEAD" }), step: 0, total: Math.max(1, todo),
      current: { msg: cur }, oursName: t("os.current", { name: head || "HEAD" }), theirsName: t("os.picking", { msg: cur }) };
  } else if (has("REVERT_HEAD")) {
    const cur = await subjectOf(root, "REVERT_HEAD");
    op = { kind: "revert", title: t("os.revert", { msg: cur }), step: 0, total: 1, current: { msg: `Revert "${cur}"` },
      oursName: t("os.current", { name: head || "HEAD" }), theirsName: t("os.reverting", { msg: cur }) };
  } else if (unmerged.length) {
    // 진행 중인 작업 없이 충돌 파일만 있는 경우 (예: stash pop 충돌)
    op = { kind: "files", title: t("os.files"), oursName: t("os.filesOurs"), theirsName: t("os.filesTheirs") };
  }

  if (!op) {
    for (const f of [CONFLICT_FILE, SPLIT_FILE]) fs.rmSync(path.join(g, f), { force: true });
    return null;
  }
  let recorded: string[] = [];
  try {
    const r = JSON.parse(fs.readFileSync(path.join(g, CONFLICT_FILE), "utf8"));
    if (r.kind === op.kind) recorded = r.files || [];
  } catch { /* 기록이 없으면 지금 충돌 파일만 */ }
  const conflicts = [...new Set([...recorded, ...unmerged])];
  const resolved: Record<string, string> = {};
  conflicts.forEach((f) => { if (!unmerged.includes(f)) resolved[f] = "done"; });
  return { real: true, ...op, conflicts, resolved };
}

/** 앱이 충돌로 멈춘 순간의 충돌 파일을 기록해 둔다 */
export async function recordConflicts(root: string): Promise<string[]> {
  const g = await gitDir(root);
  const kind = readOpKind(root);
  const st = await readStatus(root);
  if (!kind && !st.conflicted.length) return [];
  fs.writeFileSync(path.join(g, CONFLICT_FILE), JSON.stringify({ kind: kind || "files", files: st.conflicted }));
  return st.conflicted;
}
