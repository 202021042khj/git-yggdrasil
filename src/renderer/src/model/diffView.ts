// 통합(unified) diff 를 좌우 비교용 행으로 바꾼다 (순수 함수)

export interface SideCell { no: number; text: string; kind: "ctx" | "add" | "del" }
export type SplitRow =
  | { kind: "hunk"; header: string }
  | { kind: "line"; left: SideCell | null; right: SideCell | null };

/** 지운 줄 묶음과 바로 뒤의 추가 줄 묶음을 한 줄씩 짝지어 나란히 놓는다 */
export function splitRows(text: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let oldNo = 0, newNo = 0, inHunk = false;
  let dels: SideCell[] = [], adds: SideCell[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ kind: "line", left: dels[i] ?? null, right: adds[i] ?? null });
    dels = []; adds = [];
  };
  for (const line of text.split("\n")) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) {
      flush();
      oldNo = Number(m[1]); newNo = Number(m[2]); inHunk = true;
      rows.push({ kind: "hunk", header: line });
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("-")) dels.push({ no: oldNo++, text: line.slice(1), kind: "del" });
    else if (line.startsWith("+")) adds.push({ no: newNo++, text: line.slice(1), kind: "add" });
    else {
      flush();
      const t = line.slice(1);
      rows.push({ kind: "line", left: { no: oldNo++, text: t, kind: "ctx" }, right: { no: newNo++, text: t, kind: "ctx" } });
    }
  }
  flush();
  return rows;
}
