// diff 를 hunk 단위로 나누고, 고른 hunk 만 담은 patch 를 만든다 (부분 stage 용)
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

/** 고른 hunk 하나만 담은 patch (git apply 에 넘긴다) */
export function patchFor(diff: ParsedDiff, index: number): string {
  const h = diff.hunks[index];
  if (!h) throw new Error("그 변경 덩어리(hunk)를 찾을 수 없습니다. 파일이 바뀌었으면 다시 열어 주세요.");
  return [...diff.header, h.header, ...h.lines].join("\n") + "\n";
}
