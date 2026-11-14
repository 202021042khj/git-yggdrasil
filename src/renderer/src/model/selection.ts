// 여러 커밋 선택: 순서 맞추기 · 같은 줄기 안의 범위 (순수 함수)
import { generations, stems, type Stems } from "@/model/graph";
import type { RepoState } from "@shared/types/repo";

/** cherry-pick 은 오래된 커밋부터 올려야 하므로 부모 사슬 길이 순으로 정렬 */
export function oldestFirst(s: RepoState, ids: string[]): string[] {
  const g = generations(s);
  return [...new Set(ids)].filter((id) => s.commits[id]).sort((a, b) => g[a] - g[b] || a.localeCompare(b));
}

/** 같은 줄기(브랜치)에 있는 두 커밋 사이 전부 (양 끝 포함). 다른 줄기면 null */
export function rangeOnStem(s: RepoState, a: string, b: string, st: Stems = stems(s)): string[] | null {
  const own = st.owner.get(a);
  if (!own || own !== st.owner.get(b)) return null;
  const ids = st.stems[own].ids;
  const i = ids.indexOf(a), j = ids.indexOf(b);
  if (i < 0 || j < 0) return null;
  return ids.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** ⌘ 클릭: 있으면 빼고 없으면 더한다 */
export const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
