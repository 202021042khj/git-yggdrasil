// 화면 모델 테스트용 가짜 저장소
import type { RepoState } from "@shared/types/repo";

type C = [id: string, parents: string[], files?: string[]];

/** commits: [id, 부모들, 바꾼 파일]. 메시지는 "msg <id>" */
export function repo(commits: C[], refs: { branches: Record<string, string>; remotes?: Record<string, string>; head?: string }, extra: Partial<RepoState> = {}): RepoState {
  return {
    commits: Object.fromEntries(commits.map(([id, parents, files = [id + ".txt"]]) => [id, { id, parents, msg: `msg ${id}`, files }])),
    branches: refs.branches,
    remotes: refs.remotes ?? {},
    head: refs.head ?? Object.keys(refs.branches)[0],
    files: [],
    working: { staged: [], unstaged: [], conflicted: [] },
    stash: [],
    op: null,
    ...extra,
  };
}

/**   main: a ─ b ─ c        (origin/main = b)
 *    feat:     b ─ x ─ y
 *    old : a ─ o                 */
export const BASE = () => repo(
  [["a", []], ["b", ["a"]], ["c", ["b"], ["shared.txt"]], ["x", ["b"]], ["y", ["x"], ["shared.txt"]], ["o", ["a"]]],
  { branches: { main: "c", feat: "y", old: "o" }, remotes: { "origin/main": "b" }, head: "main" },
);
