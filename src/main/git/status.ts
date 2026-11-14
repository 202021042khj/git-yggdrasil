// 작업 영역 상태 (git status)
import { git } from "@/git/cli";
import type { WorkingState } from "@shared/types/repo";

/** git status --porcelain=v1 -z : "XY path\0" (이름 변경은 뒤에 원래 경로가 한 번 더) */
export async function readStatus(root: string): Promise<WorkingState> {
  const out = await git(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  const staged: string[] = [], unstaged: string[] = [], conflicted: string[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const x = p[0], y = p[1], file = p.slice(3);
    if (x === "R" || x === "C") i++; // 원래 경로 건너뛰기
    const unmerged = x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");
    if (unmerged) conflicted.push(file);
    else if (x === "?" && y === "?") unstaged.push(file);
    else {
      if (x !== " ") staged.push(file);
      // 일부만 stage 한 파일은 양쪽에 모두 나온다 (부분 stage)
      if (y !== " ") unstaged.push(file);
    }
  }
  return { staged, unstaged, conflicted };
}

export interface StatusRow {
  x: string;
  y: string;
  file: string;
}

/** status 를 줄 단위로 (X·Y 코드 그대로) */
export async function statusRows(root: string): Promise<StatusRow[]> {
  const out = await git(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  const rows: StatusRow[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    rows.push({ x: p[0], y: p[1], file: p.slice(3) });
    if (p[0] === "R" || p[0] === "C") i++;
  }
  return rows;
}

/** 아직 해결하지 않은 충돌 파일 */
export async function unmergedFiles(root: string): Promise<string[]> {
  const out = await git(root, ["diff", "--name-only", "--diff-filter=U", "-z"], { allowFail: true });
  return (out || "").split("\0").filter(Boolean);
}
