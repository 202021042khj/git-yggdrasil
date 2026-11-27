// 진행 중인 작업 (rebase · merge · cherry-pick · revert 가 충돌이나 편집으로 멈춘 상태)을 .git 에서 읽는다
import fs from "node:fs";
import path from "node:path";
import { git } from "@/git/cli";
import { readStatus } from "@/git/status";
import { t } from "@shared/i18n/i18n";
import type { BisectState, OpKind, OpState } from "@shared/types/repo";

/** 앱이 멈춘 시점의 충돌 파일 목록 (해결한 파일을 ✓ 로 보여 주려고 남긴다) */
const CONFLICT_FILE = "ygg-conflicts.json";
/** 커밋 분할 중이라는 표시 (rebase 의 edit 로 멈춘 것과 구분) */
export const SPLIT_FILE = "ygg-split.json";
/** stash pop/apply 가 충돌로 멈췄을 때 어떤 stash 였는지 (번호는 밀리므로 커밋 해시로 기억한다) */
export const STASH_FILE = "ygg-stash.json";

export interface StashMark {
  oid: string;
  msg: string;
  /** apply 였으면 true (해결해도 stash 를 지우지 않는다) */
  keep: boolean;
}

export async function readStashMark(root: string): Promise<StashMark | null> {
  try { return JSON.parse(fs.readFileSync(path.join(await gitDir(root), STASH_FILE), "utf8")); } catch { return null; }
}
export async function writeStashMark(root: string, mark: StashMark | null): Promise<void> {
  const f = path.join(await gitDir(root), STASH_FILE);
  if (mark) fs.writeFileSync(f, JSON.stringify(mark));
  else fs.rmSync(f, { force: true });
}

export async function gitDir(root: string): Promise<string> {
  const d = ((await git(root, ["rev-parse", "--git-dir"], { allowFail: true })) || ".git").trim();
  return path.isAbsolute(d) ? d : path.join(root, d);
}

/** 진행 중인 작업 종류만 빠르게 */
export function readOpKind(root: string): Exclude<OpKind, "files" | "stash" | "split"> | null {
  const g = path.join(root, ".git");
  const has = (f: string) => fs.existsSync(path.join(g, f));
  // git am 도 rebase-apply 폴더를 쓴다. am 일 때만 applying 파일이 있다
  if (has(path.join("rebase-apply", "applying"))) return "am";
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

/** 작업 영역에 변경이 남아 있는지 (추적 중인 파일만) */
const dirty = async (root: string) => !!((await git(root, ["status", "--porcelain", "-uno"], { allowFail: true })) || "").trim();

type OpBase = Omit<OpState, "conflicts" | "resolved">;

/** 화면의 state.op 모양으로 돌려준다 */
export async function readOpState(root: string, unmerged: string[], head: string | null): Promise<OpState | null> {
  const g = await gitDir(root);
  const has = (f: string) => fs.existsSync(path.join(g, f));
  let op: OpBase | null = null;
  let stash: StashMark | null = null;

  if (has(path.join("rebase-apply", "applying"))) {
    // git am 이 충돌로 멈춤: 몇 번째 패치인지와 그 패치의 제목
    const dir = path.join(g, "rebase-apply");
    const step = Number(readText(path.join(dir, "next")) || 1);
    const total = Number(readText(path.join(dir, "last")) || step);
    const subject = (readText(path.join(dir, "final-commit")) || readText(path.join(dir, "msg"))).split("\n")[0] || t("os.currentCommit");
    op = { kind: "am", title: t("os.am", { branch: head || "HEAD" }), step: Math.max(0, step - 1), total, current: { msg: subject },
      oursName: t("os.current", { name: head || "HEAD" }), theirsName: t("os.patching", { msg: subject }) };
  } else if (has("rebase-merge") || has("rebase-apply")) {
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
  } else if ((stash = await readStashMark(root)) && (unmerged.length || await dirty(root))) {
    // stash pop/apply 충돌: 파일을 다 해결해도 stash 정리를 고를 때까지 남긴다
    op = { kind: "stash", title: t("os.stash", { msg: stash.msg }), stash: { oid: stash.oid, keep: stash.keep },
      oursName: t("os.filesOurs"), theirsName: t("os.stashTheirs", { msg: stash.msg }) };
  } else if (unmerged.length) {
    // 진행 중인 작업 없이 충돌 파일만 있는 경우 (예: stash pop 충돌)
    op = { kind: "files", title: t("os.files"), oursName: t("os.filesOurs"), theirsName: t("os.filesTheirs") };
  }

  if (!op) {
    for (const f of [CONFLICT_FILE, SPLIT_FILE, STASH_FILE]) fs.rmSync(path.join(g, f), { force: true });
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
  const kind = readOpKind(root) || (fs.existsSync(path.join(g, STASH_FILE)) ? "stash" : null);
  const st = await readStatus(root);
  if (!kind && !st.conflicted.length) return [];
  fs.writeFileSync(path.join(g, CONFLICT_FILE), JSON.stringify({ kind: kind || "files", files: st.conflicted }));
  return st.conflicted;
}

/** git bisect 가 진행 중인지 (터미널에서 시작한 것도 .git/BISECT_START 로 안다) */
export async function bisecting(root: string): Promise<boolean> {
  return fs.existsSync(path.join(await gitDir(root), "BISECT_START"));
}

/** 진행 중인 bisect: 표시한 커밋 · 지금 시험 중인 커밋 · 남은 단계 추정 · 찾아낸 첫 나쁜 커밋 */
export async function readBisectState(root: string): Promise<BisectState | null> {
  const g = await gitDir(root);
  if (!fs.existsSync(path.join(g, "BISECT_START"))) return null;
  const refs = ((await git(root, ["for-each-ref", "--format=%(refname)\x1f%(objectname)", "refs/bisect"], { allowFail: true })) || "")
    .split("\n").filter(Boolean).map((l) => l.split("\x1f"));
  const bad = refs.find(([r]) => r === "refs/bisect/bad")?.[1] ?? null;
  const good = refs.filter(([r]) => r.startsWith("refs/bisect/good-")).map(([, o]) => o);
  const skipped = refs.filter(([r]) => r.startsWith("refs/bisect/skip-")).map(([, o]) => o);
  const current = ((await git(root, ["rev-parse", "-q", "--verify", "HEAD"], { allowFail: true })) || "").trim() || null;
  let remaining: number | null = null, steps: number | null = null, first: string | null = null;
  if (bad && good.length) {
    // 후보 = bad 에서 닿고 good 에서는 안 닿는 커밋. bad 하나만 남으면 그게 첫 나쁜 커밋
    const range = [bad, "--not", ...good];
    const count = Number(((await git(root, ["rev-list", "--count", ...range], { allowFail: true })) || "0").trim());
    if (count === 1) first = bad;
    else {
      const vars = (await git(root, ["rev-list", "--bisect-vars", ...range], { allowFail: true })) || "";
      const num = (k: string) => { const m = vars.match(new RegExp(`^${k}=(\\d+)`, "m")); return m ? Number(m[1]) : null; };
      remaining = num("bisect_nr");
      steps = num("bisect_steps");
    }
  }
  return { original: readText(path.join(g, "BISECT_START")), bad, good, skipped, current, remaining, steps, first };
}
