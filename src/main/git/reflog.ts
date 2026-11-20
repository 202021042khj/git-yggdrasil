// reflog: HEAD 가 거쳐 간 커밋 기록과 앱이 남긴 백업. 어느 브랜치·태그에서도 닿지 않는 "잃어버린" 커밋을 표시한다.
import { execFile } from "node:child_process";
import { git } from "@/git/cli";
import { t, type MessageKey } from "@shared/i18n/i18n";
import type { ReflogEntry } from "@shared/types/ipc";

const US = "\x1f";
export const REFLOG_LIMIT = 300;

function stdinGit(root: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }, (_e, out) => resolve(out || ""));
    child.stdin?.end(input);
  });
}

/** reflog 의 "checkout: moving from a to b" 같은 문구를 우리말로 */
export function describeAction(gs: string): { action: string; detail: string } {
  const i = gs.indexOf(": ");
  const raw = i < 0 ? gs : gs.slice(0, i);
  const detail = i < 0 ? "" : gs.slice(i + 2);
  const kind = raw.split(" ")[0];
  const NAMES: Record<string, MessageKey> = {
    commit: "rf.commit", checkout: "rf.checkout", reset: "rf.reset", branch: "rf.branch", am: "rf.am", switch: "rf.checkout",
  };
  // rebase · merge · pull · cherry-pick · revert · clone 은 git 낱말 그대로
  let action = NAMES[kind] ? t(NAMES[kind]) : raw;
  if (/\(amend\)/.test(raw)) action = t("rf.amend");
  else if (/\(initial\)/.test(raw)) action = t("rf.initial");
  else if (/\(merge\)/.test(raw)) action = t("rf.mergeCommit");
  else if (kind === "rebase") {
    const step = /\((finish|start|pick|continue|abort|reword|fixup|squash)\)/.exec(raw)?.[1];
    if (step) action = `rebase ${step}`;
  }
  const moving = /^moving from (.+) to (.+)$/.exec(detail);
  const movingTo = /^moving to (.+)$/.exec(detail);
  return { action, detail: moving ? `${moving[1]} → ${moving[2]}` : movingTo ? `→ ${movingTo[1]}` : detail };
}

export async function readReflog(root: string, limit = REFLOG_LIMIT): Promise<ReflogEntry[]> {
  const [log, backups] = await Promise.all([
    git(root, ["reflog", "show", "--date=unix", `-n${limit}`, `--format=%H${US}%gd${US}%gs`, "HEAD"], { allowFail: true }),
    git(root, ["for-each-ref", "--sort=-creatordate", `--format=%(objectname)${US}%(refname)${US}%(creatordate:unix)`, "refs/yggdrasil/backup/"], { allowFail: true }),
  ]);
  const entries: ReflogEntry[] = [];
  for (const line of (log || "").split("\n").filter(Boolean)) {
    const [id, gd, gs] = line.split(US);
    const date = Number(/@\{(\d+)\}/.exec(gd)?.[1] ?? 0) * 1000;
    entries.push({ id, ...describeAction(gs || ""), date, subject: "", lost: false, source: "reflog" });
  }
  for (const line of (backups || "").split("\n").filter(Boolean)) {
    const [id, ref, when] = line.split(US);
    entries.push({ id, action: t("rf.backup"), detail: ref.replace("refs/yggdrasil/backup/", ""), date: Number(when) * 1000, subject: "", lost: false, source: "backup" });
  }
  const ids = [...new Set(entries.map((e) => e.id))];
  if (!ids.length) return entries;
  // 브랜치·태그·원격·HEAD 어디에서도 닿지 않는 커밋 (백업 ref 는 "잃어버림" 판단에서 뺀다)
  const [lostOut, subjOut] = await Promise.all([
    stdinGit(root, ["rev-list", "--stdin", "--ignore-missing"], [...ids, "--not", "--branches", "--tags", "--remotes", "HEAD"].join("\n") + "\n"),
    stdinGit(root, ["log", "--no-walk=unsorted", "--stdin", "--ignore-missing", `--format=%H${US}%s`], ids.join("\n") + "\n"),
  ]);
  const lost = new Set(lostOut.split("\n").filter(Boolean));
  const subject = new Map(subjOut.split("\n").filter(Boolean).map((l) => l.split(US) as [string, string]));
  return entries
    .map((e) => ({ ...e, lost: lost.has(e.id), subject: subject.get(e.id) ?? t("rf.gone") }))
    .sort((a, b) => b.date - a.date);
}
