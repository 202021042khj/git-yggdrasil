// 그래프 필터: 고른 브랜치만 보이기 (숨김) · 작성자·기간에 맞지 않는 커밋 흐리게 (순수 함수)
import type { RepoState } from "@shared/types/repo";

export interface GraphFilter {
  /** 보일 브랜치. null 이면 전부. 체크아웃한 브랜치는 항상 보인다 */
  branches: string[] | null;
  /** 작성자 이름 일부 (대소문자 무시). 빈 문자열이면 거르지 않음 */
  author: string;
  /** 이 시각(ms) 이후 커밋만 진하게. null 이면 전부 */
  since: number | null;
}

export const NO_FILTER: GraphFilter = { branches: null, author: "", since: null };
export const isFiltering = (f: GraphFilter) => !!f.branches || !!f.author.trim() || f.since !== null;

/** 고른 브랜치(와 그 원격·태그)에서 닿는 커밋만 남긴 저장소 상태. 거를 게 없으면 원본 그대로 */
export function visibleRepo(s: RepoState, f: GraphFilter): RepoState {
  if (!f.branches) return s;
  const keepBranches = new Set(f.branches.filter((b) => s.branches[b]));
  if (s.head && s.branches[s.head]) keepBranches.add(s.head);
  const branches = Object.fromEntries(Object.entries(s.branches).filter(([b]) => keepBranches.has(b)));
  const remotes = Object.fromEntries(Object.entries(s.remotes).filter(([r]) => keepBranches.has(r.split("/").slice(1).join("/"))));
  const seen = new Set<string>();
  const stack = [...Object.values(branches), ...Object.values(remotes), ...(s.detached ? [s.detached] : [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c) || !s.commits[c]) continue;
    seen.add(c);
    stack.push(...s.commits[c].parents);
  }
  const commits = Object.fromEntries(Object.entries(s.commits).filter(([c]) => seen.has(c)));
  const tags = s.tags ? Object.fromEntries(Object.entries(s.tags).filter(([, t]) => seen.has(t.target))) : s.tags;
  return { ...s, commits, branches, remotes, tags };
}

/** 작성자·기간 조건에 맞지 않아 흐리게 그릴 커밋 */
export function dimmedCommits(s: RepoState, f: GraphFilter): Set<string> {
  const who = f.author.trim().toLowerCase();
  const out = new Set<string>();
  if (!who && f.since === null) return out;
  for (const c of Object.values(s.commits)) {
    const byAuthor = !who || (c.author || "").toLowerCase().includes(who);
    const byDate = f.since === null || (c.date ?? 0) >= f.since;
    if (!byAuthor || !byDate) out.add(c.id);
  }
  return out;
}
