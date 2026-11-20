// 읽기 전용 조회: 커밋 검색 · 파일 히스토리 · blame · 변경 덩어리(hunk)
import fs from "node:fs";
import path from "node:path";
import { git } from "@/git/cli";
import { parseDiff } from "@/git/patch";
import { t } from "@shared/i18n/i18n";
import type { BlameLine, FileHistoryEntry, Hunk, SearchHit } from "@shared/types/ipc";

const US = "\x1f";
const RS = "\x1e";
const SEARCH_LIMIT = 100;
const HISTORY_LIMIT = 300;

const parseLog = (out: string | null): SearchHit[] =>
  (out || "").split(RS).filter((r) => r.trim()).map((r) => {
    const [id, msg, author, at] = r.trim().split(US);
    return { id, msg, author, date: Number(at) * 1000 };
  });

const LOG_FORMAT = `--format=${RS}%H${US}%s${US}%an${US}%at`;

/** 메시지 · 작성자 · 커밋 ID 로 찾는다 */
export async function searchCommits(root: string, query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const all = ["--branches", "--remotes", "--tags", "HEAD"];
  const [byMsg, byAuthor] = await Promise.all([
    git(root, ["log", ...all, "-i", "--fixed-strings", `--grep=${q}`, `-n${SEARCH_LIMIT}`, LOG_FORMAT], { allowFail: true }),
    git(root, ["log", ...all, "-i", `--author=${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, `-n${SEARCH_LIMIT}`, LOG_FORMAT], { allowFail: true }),
  ]);
  const hits = [...parseLog(byMsg), ...parseLog(byAuthor)];
  if (/^[0-9a-f]{4,40}$/i.test(q)) {
    const id = ((await git(root, ["rev-parse", "-q", "--verify", `${q}^{commit}`], { allowFail: true })) || "").trim();
    if (id) hits.unshift(...parseLog(await git(root, ["log", "-n1", LOG_FORMAT, id], { allowFail: true })));
  }
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.id) && seen.add(h.id)).slice(0, SEARCH_LIMIT);
}

/** 파일을 바꾼 커밋들 (이름이 바뀐 경우도 따라간다) */
export async function fileHistory(root: string, file: string): Promise<FileHistoryEntry[]> {
  const out = await git(root, ["log", "--follow", `-n${HISTORY_LIMIT}`, "--name-only", LOG_FORMAT, "--", file], { allowFail: true });
  return (out || "").split(RS).filter((r) => r.trim()).map((r) => {
    const [head, ...rest] = r.trim().split("\n");
    const [id, msg, author, at] = head.split(US);
    return { id, msg, author, date: Number(at) * 1000, path: rest.filter(Boolean)[0] || file };
  });
}

/** 줄마다 마지막으로 바꾼 커밋 */
export async function blame(root: string, file: string, commit?: string | null): Promise<BlameLine[]> {
  const out = await git(root, ["blame", "--porcelain", ...(commit ? [commit] : []), "--", file]);
  const meta: Record<string, { author: string; date: number; summary: string }> = {};
  const lines: BlameLine[] = [];
  let cur: { commit: string; line: number } | null = null;
  for (const l of out.split("\n")) {
    const head = l.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (head) {
      cur = { commit: head[1], line: Number(head[2]) };
      meta[head[1]] ||= { author: "", date: 0, summary: "" };
      continue;
    }
    if (!cur) continue;
    const m = meta[cur.commit];
    if (l.startsWith("author ")) m.author = l.slice(7);
    else if (l.startsWith("author-time ")) m.date = Number(l.slice(12)) * 1000;
    else if (l.startsWith("summary ")) m.summary = l.slice(8);
    else if (l.startsWith("\t")) lines.push({ line: cur.line, text: l.slice(1), commit: cur.commit, ...meta[cur.commit] });
  }
  // porcelain 은 같은 커밋의 메타를 처음 한 번만 준다 → 나중 줄들도 채운다
  return lines.map((ln) => ({ ...ln, ...meta[ln.commit] }));
}

/** 파일의 변경 덩어리 (staged=true 면 stage 된 쪽) */
/** 충돌 중인 파일의 지금 내용 (충돌 표시 포함). 너무 크거나 바이너리면 null */
export function conflictText(root: string, file: string): string | null {
  const full = path.resolve(root, file);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(t("m.outside", { path: file }));
  const buf = fs.readFileSync(full);
  if (buf.length > 2_000_000 || buf.includes(0)) return null;
  return buf.toString("utf8");
}

export async function hunks(root: string, file: string, staged: boolean): Promise<Hunk[]> {
  const out = await git(root, ["diff", "--no-color", ...(staged ? ["--cached"] : []), "--", file], { allowFail: true });
  return parseDiff(out || "").hunks;
}
