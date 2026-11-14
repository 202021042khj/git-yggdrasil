// 충돌 표시(<<<<<<< ||||||| ======= >>>>>>>)가 든 파일을 구간으로 나누고, 고른 대로 합친다 (순수 함수)

export interface TextChunk { kind: "text"; lines: string[] }
export interface ConflictChunk {
  kind: "conflict";
  /** git 의 ours (A 쪽) */
  ours: string[];
  /** diff3 형식일 때만 있는 공통 조상 */
  base: string[] | null;
  /** git 의 theirs (B 쪽) */
  theirs: string[];
  oursLabel: string;
  theirsLabel: string;
}
export type Chunk = TextChunk | ConflictChunk;
export type Choice = "ours" | "theirs" | "ours-theirs" | "theirs-ours" | null;

export function parseConflict(text: string): Chunk[] {
  const lines = text.split("\n");
  const out: Chunk[] = [];
  let plain: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.startsWith("<<<<<<<")) { plain.push(l); i++; continue; }
    // 짝이 맞는지 먼저 확인 (중간에 끊긴 표시는 그냥 글자로 둔다)
    let j = i + 1, sep = -1, baseAt = -1, end = -1;
    for (; j < lines.length; j++) {
      if (lines[j].startsWith("|||||||") && sep < 0 && baseAt < 0) baseAt = j;
      else if (lines[j] === "=======" && sep < 0) sep = j;
      else if (lines[j].startsWith(">>>>>>>") && sep >= 0) { end = j; break; }
      else if (lines[j].startsWith("<<<<<<<")) break;
    }
    if (end < 0) { plain.push(l); i++; continue; }
    if (plain.length) out.push({ kind: "text", lines: plain });
    plain = [];
    out.push({
      kind: "conflict",
      ours: lines.slice(i + 1, baseAt >= 0 ? baseAt : sep),
      base: baseAt >= 0 ? lines.slice(baseAt + 1, sep) : null,
      theirs: lines.slice(sep + 1, end),
      oursLabel: l.slice(7).trim(),
      theirsLabel: lines[end].slice(7).trim(),
    });
    i = end + 1;
  }
  if (plain.length) out.push({ kind: "text", lines: plain });
  return out;
}

export const conflictCount = (chunks: Chunk[]) => chunks.filter((c) => c.kind === "conflict").length;

/** 고른 대로 합친 내용. 아직 안 고른 구간은 충돌 표시를 그대로 남긴다 */
export function composeResolved(chunks: Chunk[], choices: Choice[]): string {
  let k = 0;
  const lines: string[] = [];
  for (const c of chunks) {
    if (c.kind === "text") { lines.push(...c.lines); continue; }
    const ch = choices[k++] ?? null;
    if (ch === "ours") lines.push(...c.ours);
    else if (ch === "theirs") lines.push(...c.theirs);
    else if (ch === "ours-theirs") lines.push(...c.ours, ...c.theirs);
    else if (ch === "theirs-ours") lines.push(...c.theirs, ...c.ours);
    else lines.push(`<<<<<<< ${c.oursLabel}`, ...c.ours, ...(c.base ? ["||||||| base", ...c.base] : []), "=======", ...c.theirs, `>>>>>>> ${c.theirsLabel}`);
  }
  return lines.join("\n");
}
