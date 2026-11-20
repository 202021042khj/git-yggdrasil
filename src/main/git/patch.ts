// diff 를 hunk 단위로 나누고, 고른 hunk 만 담은 patch 를 만든다 (부분 stage 용)
import { t } from "@shared/i18n/i18n";
import type { Hunk } from "@shared/types/ipc";

export interface ParsedDiff {
  /** "diff --git" 부터 첫 "@@" 전까지 (파일 머리) */
  header: string[];
  hunks: Hunk[];
}

export function parseDiff(text: string): ParsedDiff {
  const lines = text.replace(/\n$/, "").split("\n");
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      cur = { index: hunks.length, header: line, lines: [] };
      hunks.push(cur);
    } else if (cur) cur.lines.push(line);
    else header.push(line);
  }
  return { header, hunks };
}

/**
 * 고른 hunk 하나만 담은 patch (git apply 에 넘긴다).
 * lines 를 주면 그 줄(hunk.lines 의 번호)의 +/- 만 반영한다. 나머지 변경 줄은
 * - stage 할 때(reverse=false): '-' 는 그대로 두는 줄(문맥)로, '+' 는 뺀다
 * - unstage 할 때(reverse=true, git apply -R): '+' 는 문맥으로, '-' 는 뺀다
 * 줄 수가 바뀌므로 git apply --recount 와 함께 쓴다.
 */
export function patchFor(diff: ParsedDiff, index: number, lines?: number[], reverse = false): string {
  const h = diff.hunks[index];
  if (!h) throw new Error(t("m.hunkMissing"));
  if (!lines) return [...diff.header, h.header, ...h.lines].join("\n") + "\n";
  const keep = new Set(lines);
  if (![...keep].some((i) => /^[+-]/.test(h.lines[i] ?? ""))) throw new Error(t("m.noChangedLines"));
  const out: string[] = [];
  let dropped = false;
  h.lines.forEach((l, i) => {
    if (l.startsWith("\\")) { if (!dropped) out.push(l); return; } // "\ No newline at end of file" 는 앞 줄을 따른다
    dropped = false;
    const sign = l[0];
    if ((sign !== "+" && sign !== "-") || keep.has(i)) { out.push(l); return; }
    const toContext = reverse ? sign === "+" : sign === "-";
    if (toContext) out.push(" " + l.slice(1));
    else dropped = true;
  });
  return [...diff.header, h.header, ...out].join("\n") + "\n";
}
