// 커밋 그래프 조회 (순수 함수): 조상, 세대, 브랜치 줄기(레인)
import { opRef } from "@/constants/layout";
import type { RepoState } from "@shared/types/repo";

export type StemKind = "local" | "remote" | "op" | "anon";

export interface Stem {
  /** 줄기의 커밋들 (오래된 것부터) */
  ids: string[];
  /** 줄기가 갈라져 나온 커밋 (첫 커밋부터 시작하면 null) */
  base: string | null;
  kind: StemKind;
  tip: string;
}

export interface Stems {
  stems: Record<string, Stem>;
  /** 커밋 → 그 커밋을 차지한 줄기 이름 */
  owner: Map<string, string>;
}

export function ancestors(s: RepoState, id: string | null | undefined): Set<string> {
  const seen = new Set<string>();
  const stack = id ? [id] : [];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c) || !s.commits[c]) continue;
    seen.add(c);
    stack.push(...s.commits[c].parents);
  }
  return seen;
}

export const isAncestor = (s: RepoState, a: string, b: string) => ancestors(s, b).has(a);

/** 커밋마다 가장 긴 부모 사슬 길이 (그래프의 x 열) */
export function generations(s: RepoState): Record<string, number> {
  const g: Record<string, number> = {};
  const calc = (id: string): number => {
    if (g[id] !== undefined) return g[id];
    const ps = s.commits[id].parents;
    return (g[id] = ps.length ? 1 + Math.max(...ps.map(calc)) : 0);
  };
  Object.keys(s.commits).forEach(calc);
  return g;
}

export function mergeBase(s: RepoState, a: string, b: string): string | null {
  const A = ancestors(s, a);
  const g = generations(s);
  let best: string | null = null;
  for (const c of ancestors(s, b)) if (A.has(c) && (best === null || g[c] > g[best])) best = c;
  return best;
}

/** 원격에 올라간(공유된) 커밋 */
export function pushedSet(s: RepoState): Set<string> {
  const set = new Set<string>();
  Object.values(s.remotes).forEach((id) => ancestors(s, id).forEach((c) => set.add(c)));
  return set;
}

export function branchOrder(s: RepoState): string[] {
  const names = Object.keys(s.branches).filter((b) => b !== "main").sort();
  return s.branches.main ? ["main", ...names] : names;
}

/**
 * 같은 커밋을 가리키는 브랜치가 여럿이면 레인 이름이 될 대표를 고른다.
 * 우선순위: main > 현재 HEAD > 원격에 올라간 브랜치 > 먼저 있던 브랜치 > 이름순.
 * 레인 위치는 묶음에서 가장 오래된 브랜치의 자리 (HEAD 를 바꿔도 레인이 움직이지 않게).
 */
export function laneOrder(s: RepoState): string[] {
  const order = branchOrder(s);
  const born = (b: string) => s.born?.[b] || 0;
  const rank = (b: string) => (b === "main" ? 0 : b === s.head ? 1 : s.remotes["origin/" + b] ? 2 : 3);
  const byTip: Record<string, string[]> = {};
  order.forEach((b) => (byTip[s.branches[b]] ||= []).push(b));
  const repOf: Record<string, string> = {}, slotOf: Record<string, string> = {};
  for (const [tip, group] of Object.entries(byTip)) {
    repOf[tip] = [...group].sort((x, y) => rank(x) - rank(y) || born(x) - born(y) || order.indexOf(x) - order.indexOf(y))[0];
    slotOf[tip] = [...group].sort((x, y) => born(x) - born(y) || order.indexOf(x) - order.indexOf(y))[0];
  }
  const out: string[] = [];
  for (const b of order) {
    const tip = s.branches[b];
    if (slotOf[tip] !== b) continue;
    const rep = repOf[tip];
    out.push(rep, ...byTip[tip].filter((x) => x !== rep));
  }
  return out;
}

/** 각 ref 의 "줄기" = 다른 줄기가 아직 차지하지 않은 first-parent 체인 */
export function stems(s: RepoState): Stems {
  const owner = new Map<string, string>();
  const res: Record<string, Stem> = {};
  const refs: Array<[string, string, StemKind]> = [
    ...laneOrder(s).map((b): [string, string, StemKind] => [b, s.branches[b], "local"]),
    ...Object.keys(s.remotes).sort().map((r): [string, string, StemKind] => [r, s.remotes[r], "remote"]),
    ...(s.op?.tip && s.commits[s.op.tip] ? [[opRef(), s.op.tip, "op"] as [string, string, StemKind]] : []),
  ];
  const claim = (name: string, tip: string, kind: StemKind) => {
    const ids: string[] = [];
    let c: string | undefined = tip;
    while (c && !owner.has(c)) {
      ids.push(c);
      owner.set(c, name);
      c = s.commits[c]?.parents[0];
    }
    res[name] = { ids: ids.reverse(), base: c || null, kind, tip };
  };
  refs.forEach(([name, tip, kind]) => claim(name, tip, kind));
  // 어느 ref 의 줄기에도 속하지 않지만 ref 에서 닿는 커밋 (예: merge 후 브랜치가 지워진 작업 커밋)
  // → 이름 없는 줄기로 그린다. 최신 커밋부터 시작해야 줄기가 끝에서부터 이어진다.
  const reach = new Set<string>();
  refs.forEach(([, tip]) => ancestors(s, tip).forEach((c) => reach.add(c)));
  if (s.detached) ancestors(s, s.detached).forEach((c) => reach.add(c));
  const g = generations(s);
  for (const tip of [...reach].filter((c) => !owner.has(c)).sort((a, b) => g[b] - g[a])) {
    if (!owner.has(tip)) claim("· " + tip.slice(0, 7), tip, "anon");
  }
  return { stems: res, owner };
}

/** 커밋이 속한 로컬 브랜치 (원격·이름 없는 줄기면 null) */
export function ownerBranch(s: RepoState, id: string, st: Stems = stems(s)): string | null {
  const o = st.owner.get(id);
  return o && s.branches[o] !== undefined ? o : null;
}

export const branchesAt = (s: RepoState, id: string) => Object.keys(s.branches).filter((b) => s.branches[b] === id);

/** 브랜치와 upstream(origin/<브랜치>) 사이의 앞섬/뒤처짐 */
export function syncInfo(s: RepoState, b: string) {
  const remoteName = s.upstream?.[b] || "origin/" + b;
  const rem = s.remotes[remoteName];
  if (!rem || !s.branches[b]) return { remote: null as string | null, ahead: 0, behind: 0 };
  const a = ancestors(s, s.branches[b]), r = ancestors(s, rem);
  return {
    remote: remoteName,
    ahead: [...a].filter((c) => !r.has(c)).length,
    behind: [...r].filter((c) => !a.has(c)).length,
  };
}
