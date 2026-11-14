// 미리보기 엔진: 조작을 놓기 전에 "결과가 어떻게 보일지" 를 메모리에서 계산한다.
// 실제 실행은 메인 프로세스가 git 으로 한다 (같은 조작 이름·인자를 그대로 보낸다).
// 충돌은 "같은 파일을 양쪽이 고쳤는가" 로만 예상한다. 실제 충돌은 실행할 때 git 이 판단한다.
import { short } from "@/lib/html";
import { pathspec, underAny } from "@/lib/paths";
import { ancestors, generations, isAncestor, mergeBase, ownerBranch, pushedSet, stems } from "@/model/graph";
import type { OpName, RebaseStep } from "@shared/types/ipc";
import type { RepoState } from "@shared/types/repo";

export interface Preview {
  state: RepoState;
  summary: string;
  /** 대응하는 git 명령 (설명용) */
  cmd: string;
  /** 충돌이 예상되는 파일 */
  conflicts: string[];
  /** 다시 쓰여서 사라지는 커밋 (push 된 것이면 force push 가 필요) */
  rewrites: string[];
  force?: boolean;
}
export type PreviewOut = Preview | { error: string };
export const isError = (r: PreviewOut): r is { error: string } => "error" in r;

const clone = (s: RepoState): RepoState => structuredClone(s);
let seq = 0;
const newId = () => `preview${(seq++).toString(16).padStart(9, "0")}`;
const ok = (state: RepoState, summary: string, cmd: string, extra: Partial<Preview> = {}): Preview =>
  ({ state, summary, cmd, conflicts: [], rewrites: [], ...extra });
const fail = (error: string) => ({ error });
const label = (s: RepoState, id: string) => `${short(id)} "${s.commits[id]?.msg ?? ""}"`;

/** 대상 쪽에만 있는 커밋이 건드린 파일과 겹치면 충돌로 본다 */
function predictConflicts(s: RepoState, files: string[], origBase: string | null, onto: string): string[] {
  const baseAnc = ancestors(s, origBase);
  const touched = new Set<string>();
  for (const c of ancestors(s, onto)) if (!baseAnc.has(c)) s.commits[c].files.forEach((f) => touched.add(f));
  return [...new Set(files)].filter((f) => touched.has(f));
}

interface Spec { keep?: string; msg?: string; files?: string[] }

/** specs 를 onto 위에 차례로 새 커밋으로 만든다 */
function replay(s: RepoState, specs: Spec[], onto: string | null): string | null {
  let tip = onto;
  for (const sp of specs) {
    const src = sp.keep ? s.commits[sp.keep] : { msg: sp.msg ?? "", files: sp.files ?? [] };
    const id = newId();
    s.commits[id] = { id, msg: src.msg, parents: tip ? [tip] : [], files: [...src.files] };
    tip = id;
  }
  return tip;
}

/** 로컬 브랜치 줄기를 새 spec 목록으로 다시 쓴다 (앞부분이 같으면 그대로 둔다). 다시 쓰인 원본 커밋을 돌려준다. */
function rewriteStem(s: RepoState, branch: string, specs: Spec[]): string[] {
  const st = stems(s).stems[branch];
  let k = 0;
  while (k < st.ids.length && k < specs.length && specs[k].keep === st.ids[k]) k++;
  const base = k === 0 ? st.base : st.ids[k - 1];
  s.branches[branch] = replay(s, specs.slice(k), base) || base || s.branches[branch];
  return st.ids.slice(k);
}

/** 커밋할 파일을 꺼낸다 (paths 지정: 그 경로만, 없으면 staged → 없으면 전체) */
function takeChanges(s: RepoState, paths?: string[]) {
  const w = s.working;
  if (paths) {
    const files = [...w.staged, ...w.unstaged].filter((f) => underAny(f, paths));
    if (!files.length) return null;
    w.staged = w.staged.filter((f) => !files.includes(f));
    w.unstaged = w.unstaged.filter((f) => !files.includes(f));
    return { files: [...new Set(files)], all: false, addCmd: "", suffix: ` -- ${pathspec(s, paths)}` };
  }
  if (w.staged.length) { const files = w.staged; w.staged = []; return { files, all: false, addCmd: "", suffix: "" }; }
  if (w.unstaged.length) { const files = w.unstaged; w.unstaged = []; return { files, all: true, addCmd: "git add . && ", suffix: "" }; }
  return null;
}

type PreviewFn = (s0: RepoState, ...args: any[]) => PreviewOut;

export const previews: Partial<Record<OpName, PreviewFn>> = {
  commitTo(s0, branch: string, msg: string, paths?: string[]) {
    const s = clone(s0);
    const t = takeChanges(s, paths);
    if (!t) return fail(paths ? "그 경로에는 변경된 파일이 없습니다." : "커밋할 변경이 없습니다.");
    const tip = branch === "HEAD" ? s.detached ?? null : s.branches[branch];
    const id = replay(s, [{ msg, files: t.files }], tip)!;
    if (branch === "HEAD") s.detached = id;
    else s.branches[branch] = id;
    const other = branch !== s.head && branch !== "HEAD";
    return ok(s, `${other ? `${branch} 에 바로 커밋 (체크아웃 없이)` : `${branch} 에 새 커밋`} · ${t.files.length}개 파일${t.all ? " (변경 전체)" : ""}`,
      t.addCmd + `git commit -m "${msg}"${t.suffix}`);
  },

  amendInto(s0, id: string, _msg: string, paths?: string[]) {
    const br = ownerBranch(s0, id);
    if (br !== s0.head) return fail("현재 브랜치(HEAD)의 커밋에만 합칠 수 있습니다.");
    const s = clone(s0);
    const t = takeChanges(s, paths);
    if (!t) return fail("합칠 변경이 없습니다.");
    const isTip = s.branches[br] === id;
    const specs = stems(s).stems[br].ids.map((c): Spec => (c === id ? { msg: s.commits[c].msg, files: [...s.commits[c].files, ...t.files] } : { keep: c }));
    const rewrites = rewriteStem(s, br, specs);
    return ok(s, isTip ? `HEAD 커밋 ${label(s0, id)} 에 합치기 (amend)` : `과거 커밋 ${label(s0, id)} 에 흡수 (fixup)`,
      t.addCmd + (isTip ? `git commit --amend${t.suffix}` : `git commit --fixup ${short(id)}${t.suffix} && git rebase -i --autosquash`), { rewrites });
  },

  cherryPick(s0, ids: string[], branch: string) {
    const s = clone(s0);
    const tip = s.branches[branch];
    if (ids.some((id) => isAncestor(s, id, tip))) return fail(`이미 ${branch} 에 포함된 커밋입니다.`);
    const conflicts = predictConflicts(s, ids.flatMap((id) => s.commits[id].files), s.commits[ids[0]].parents[0] ?? null, tip);
    s.branches[branch] = replay(s, ids.map((id) => ({ keep: id })), tip)!;
    return ok(s, `${ids.map((i) => label(s0, i)).join(", ")} 를 ${branch} 에 복사`, `git cherry-pick ${ids.map(short).join(" ")}  # → ${branch}`, { conflicts });
  },

  moveCommit(s0, id: string, branch: string) {
    const src = ownerBranch(s0, id);
    if (!src) return fail("로컬 브랜치의 커밋만 옮길 수 있습니다.");
    if (src === branch) return fail("같은 브랜치입니다. 순서를 바꾸려면 커밋 사이 틈에 놓으세요.");
    const r = previews.cherryPick!(s0, [id], branch);
    if (isError(r)) return r;
    const s = r.state;
    const specs = stems(s).stems[src].ids.filter((c) => c !== id).map((c) => ({ keep: c }));
    const rewrites = rewriteStem(s, src, specs);
    return ok(s, `${label(s0, id)} 를 ${src} → ${branch} 로 이동`,
      `git cherry-pick ${short(id)}  # → ${branch}\ngit rebase --onto ${short(id)}~1 ${short(id)} ${src}`, { conflicts: r.conflicts, rewrites: [id, ...rewrites] });
  },

  dropCommit(s0, id: string) {
    const br = ownerBranch(s0, id);
    if (!br) return fail("로컬 브랜치의 커밋만 제거할 수 있습니다.");
    const s = clone(s0);
    const rewrites = rewriteStem(s, br, stems(s).stems[br].ids.filter((c) => c !== id).map((c) => ({ keep: c })));
    return ok(s, `${label(s0, id)} 를 ${br} 에서 제거`, `git rebase --onto ${short(id)}~1 ${short(id)} ${br}`, { rewrites });
  },

  revertCommit(s0, id: string) {
    if (!isAncestor(s0, id, s0.branches[s0.head])) return fail(`현재 브랜치(${s0.head})에 있는 커밋만 되돌릴 수 있습니다.`);
    const s = clone(s0);
    const c = s.commits[id];
    s.branches[s.head] = replay(s, [{ msg: `Revert "${c.msg}"`, files: c.files }], s.branches[s.head])!;
    return ok(s, `push 된 커밋이라 삭제 대신 되돌림 커밋 생성`, `git revert ${short(id)}`);
  },

  squash(s0, src: string, dst: string) {
    const br = ownerBranch(s0, src);
    if (!br || br !== ownerBranch(s0, dst)) return fail("같은 브랜치 줄기 안의 커밋끼리만 합칠 수 있습니다.");
    const s = clone(s0);
    const specs: Spec[] = [];
    for (const c of stems(s).stems[br].ids) {
      if (c === src) continue;
      specs.push(c === dst ? { msg: s.commits[dst].msg, files: [...s.commits[dst].files, ...s.commits[src].files] } : { keep: c });
    }
    const rewrites = rewriteStem(s, br, specs);
    return ok(s, `${label(s0, src)} 를 ${label(s0, dst)} 에 합치기`, `git rebase -i  # fixup ${short(src)} → ${short(dst)}`, { rewrites });
  },

  /** 커밋 정리(interactive rebase): 위에서부터 오래된 커밋 */
  rebasePlan(s0, branch: string, steps: RebaseStep[]) {
    const st = stems(s0).stems[branch];
    if (!st) return fail("로컬 브랜치만 정리할 수 있습니다.");
    if (steps.length !== st.ids.length || !steps.every((x) => st.ids.includes(x.id))) return fail("계획이 지금 브랜치의 커밋과 맞지 않습니다.");
    const kept = steps.filter((x) => x.action !== "drop");
    if (!kept.length) return fail("커밋을 모두 뺄 수는 없습니다.");
    if (kept[0].action === "squash" || kept[0].action === "fixup") return fail("맨 위(가장 오래된) 커밋은 앞에 합칠 커밋이 없습니다.");
    if (steps.some((x) => (x.action === "reword" || x.action === "squash") && !(x.msg ?? "").trim())) return fail("메시지가 비어 있는 줄이 있습니다.");
    const s = clone(s0);
    const specs: Spec[] = [];
    for (const x of kept) {
      const c = s.commits[x.id];
      const last = specs[specs.length - 1];
      if ((x.action === "squash" || x.action === "fixup") && last) {
        const files = [...(last.files ?? s.commits[last.keep!].files), ...c.files];
        specs[specs.length - 1] = { msg: x.action === "squash" ? x.msg! : last.msg ?? s.commits[last.keep!].msg, files: [...new Set(files)] };
      } else if (x.action === "reword") specs.push({ msg: x.msg!, files: [...c.files] });
      else specs.push({ keep: x.id });
    }
    const same = specs.length === st.ids.length && specs.every((sp, i) => sp.keep === st.ids[i]);
    if (same) return fail("바뀐 것이 없습니다.");
    // 순서를 바꾼 커밋이 같은 파일을 건드리면 충돌할 수 있다
    const moved = kept.filter((x, i) => st.ids.filter((id) => kept.some((k) => k.id === id))[i] !== x.id);
    const seen = new Map<string, number>();
    moved.forEach((x) => s0.commits[x.id].files.forEach((f) => seen.set(f, (seen.get(f) ?? 0) + 1)));
    const dropped = steps.filter((x) => x.action === "drop");
    const later = new Set(kept.flatMap((x) => s0.commits[x.id].files));
    const conflicts = [...new Set([...[...seen].filter(([, n]) => n > 1).map(([f]) => f), ...dropped.flatMap((x) => s0.commits[x.id].files.filter((f) => later.has(f)))])];
    const rewrites = rewriteStem(s, branch, specs);
    const counts = (["reword", "squash", "fixup", "drop"] as const).map((a) => [a, steps.filter((x) => x.action === a).length] as const).filter(([, n]) => n);
    const parts = [moved.length ? "순서 변경" : "", ...counts.map(([a, n]) => `${{ reword: "메시지 수정", squash: "합치기", fixup: "합치기(메시지 버림)", drop: "빼기" }[a]} ${n}`)].filter(Boolean);
    return ok(s, `${branch} 커밋 정리: ${parts.join(", ")}`, `git rebase -i ${st.base ? short(st.base) : "--root"}  # ${branch}`, { conflicts, rewrites });
  },

  reorder(s0, id: string, branch: string, index: number) {
    if (ownerBranch(s0, id) !== branch) return fail("같은 브랜치 안에서만 순서를 바꿀 수 있습니다.");
    const s = clone(s0);
    const ids = stems(s).stems[branch].ids;
    const from = ids.indexOf(id);
    if (index === from || index === from + 1) return fail("제자리입니다.");
    const order = ids.filter((c) => c !== id);
    order.splice(index > from ? index - 1 : index, 0, id);
    const rewrites = rewriteStem(s, branch, order.map((c) => ({ keep: c })));
    return ok(s, `${label(s0, id)} 의 순서 변경`, `git rebase -i  # ${short(id)} 이동`, { rewrites });
  },

  rebaseStem(s0, branch: string, onto: string) {
    const st = stems(s0).stems[branch];
    if (!st || !st.ids.length) return fail("옮길 커밋이 없습니다.");
    if (!st.base) return fail(`${branch} 는 첫 커밋부터 시작하는 줄기라 다른 커밋 위로 올릴 수 없습니다.`);
    if (st.base === onto) return fail("이미 그 커밋 위에 있습니다.");
    if (st.ids.includes(onto)) return fail("자기 자신 위로는 옮길 수 없습니다.");
    const s = clone(s0);
    const conflicts = predictConflicts(s, st.ids.flatMap((c) => s.commits[c].files), st.base, onto);
    s.branches[branch] = replay(s, st.ids.map((c) => ({ keep: c })), onto)!;
    return ok(s, `${branch} 의 커밋 ${st.ids.length}개를 ${label(s0, onto)} 위로 이동`,
      `git rebase --onto ${short(onto)} ${short(st.base)} ${branch}`, { conflicts, rewrites: st.ids });
  },

  merge(s0, src: string, dst: string) {
    if (src === dst) return fail("같은 브랜치입니다.");
    const s = clone(s0);
    const a = s.branches[dst], b = s.branches[src];
    if (isAncestor(s, b, a)) return fail(`${src} 는 이미 ${dst} 에 병합되어 있습니다.`);
    if (isAncestor(s, a, b)) {
      s.branches[dst] = b;
      return ok(s, `${dst} 를 ${src} 까지 fast-forward`, `git merge ${src}  # fast-forward`);
    }
    const base = mergeBase(s, a, b);
    const baseAnc = ancestors(s, base);
    const conflicts = predictConflicts(s, [...ancestors(s, b)].filter((c) => !baseAnc.has(c)).flatMap((c) => s.commits[c].files), base, a);
    const id = newId();
    s.commits[id] = { id, msg: `Merge ${src} into ${dst}`, parents: [a, b], files: [] };
    s.branches[dst] = id;
    return ok(s, `${src} 를 ${dst} 에 병합 (merge 커밋)`, `git merge ${src}  # → ${dst}`, { conflicts });
  },

  moveBranch(s0, branch: string, id: string) {
    const s = clone(s0);
    const old = s.branches[branch];
    if (old === id) return fail("이미 그 위치입니다.");
    const keep = ancestors(s, id);
    const rewrites = [...ancestors(s, old)].filter((c) => !keep.has(c));
    s.branches[branch] = id;
    return ok(s, `${branch} 포인터를 ${label(s0, id)} 로 이동${rewrites.length ? ` (커밋 ${rewrites.length}개가 브랜치에서 빠짐)` : ""}`,
      branch === s.head ? `git reset --keep ${short(id)}` : `git branch -f ${branch} ${short(id)}`, { rewrites });
  },

  resetHead(s0, id: string, mode: "soft" | "mixed" | "hard" = "mixed") {
    const br = s0.head, tip = s0.branches[br];
    if (tip === id) return fail("이미 그 위치입니다.");
    if (!isAncestor(s0, id, tip)) return fail("현재 브랜치의 과거 커밋으로만 되돌릴 수 있습니다.");
    const s = clone(s0);
    const keep = ancestors(s, id);
    const removed = [...ancestors(s, tip)].filter((c) => !keep.has(c));
    const files = [...new Set(removed.flatMap((c) => s.commits[c].files))];
    const w = s.working;
    if (mode === "soft") { w.staged = [...new Set([...w.staged, ...files])]; w.unstaged = w.unstaged.filter((f) => !w.staged.includes(f)); }
    else if (mode === "mixed") { w.unstaged = [...new Set([...w.staged, ...w.unstaged, ...files])]; w.staged = []; }
    else { w.unstaged = []; w.staged = []; }
    s.branches[br] = id;
    const what = { soft: "변경은 Staged 로", mixed: "변경은 작업 영역으로", hard: "변경까지 모두 버림" }[mode];
    return ok(s, `커밋 ${removed.length}개 취소 (${what})`, `git reset --${mode} ${short(id)}`, { rewrites: removed });
  },

  createBranch(s0, name: string, id: string) {
    if (!name) return fail("이름이 없습니다.");
    if (s0.branches[name]) return fail(`${name} 브랜치가 이미 있습니다.`);
    const s = clone(s0);
    s.branches[name] = id;
    s.born = { ...(s.born || {}), [name]: Object.keys(s.born || {}).length + 1 };
    return ok(s, `${label(s0, id)} 에서 새 브랜치 ${name}`, `git branch ${name} ${short(id)}`);
  },

  deleteBranch(s0, name: string) {
    if (name === s0.head) return fail("현재 체크아웃된 브랜치는 삭제할 수 없습니다.");
    const s = clone(s0);
    const tip = s.branches[name];
    delete s.branches[name];
    const merged = [...Object.values(s.branches), ...Object.values(s.remotes)].some((t) => isAncestor(s, tip, t));
    if (!merged) return fail(`${name} 에는 다른 곳에 병합되지 않은 커밋이 있어 지울 수 없습니다. (git 이 거절합니다)`);
    return ok(s, `${name} 브랜치 삭제`, `git branch -d ${name}`);
  },

  push(s0, branch: string) {
    const s = clone(s0);
    const r = s.upstream?.[branch] || "origin/" + branch;
    const remote = s.remotes[r];
    const local = s.branches[branch];
    if (remote === local) return fail("이미 최신 상태입니다.");
    const force = !!remote && !isAncestor(s, remote, local);
    s.remotes[r] = local;
    return ok(s, force ? `${branch} 강제 push — 원격 히스토리를 덮어씁니다` : remote ? `${branch} push` : `${branch} 를 원격에 처음 publish`,
      force ? `git push --force-with-lease` : remote ? "git push" : `git push -u origin ${branch}`, { force });
  },

  pull(s0, branch: string, mode: "merge" | "rebase" = "merge", remote = s0.upstream?.[branch] || "origin/" + branch) {
    const r = s0.remotes[remote], l = s0.branches[branch];
    if (!r) return fail(`${branch} 의 upstream(${remote})이 없습니다. 먼저 push 하세요.`);
    if (isAncestor(s0, r, l)) return fail("이미 최신입니다. 받을 커밋이 없습니다.");
    if (branch !== s0.head) return fail("체크아웃한 브랜치에만 pull 할 수 있습니다. 먼저 그 브랜치로 전환하세요.");
    const s = clone(s0);
    if (isAncestor(s, l, r)) {
      s.branches[branch] = r;
      return ok(s, `${remote} 를 받아서 ${branch} fast-forward`, "git pull  # fast-forward");
    }
    const base = mergeBase(s, l, r);
    const baseAnc = ancestors(s, base);
    const g = generations(s);
    const localOnly = [...ancestors(s, l)].filter((c) => !baseAnc.has(c)).sort((a, b) => g[a] - g[b]);
    if (mode === "rebase") {
      const conflicts = predictConflicts(s, localOnly.flatMap((c) => s.commits[c].files), base, r);
      s.branches[branch] = replay(s, localOnly.map((c) => ({ keep: c })), r)!;
      return ok(s, `${remote} 를 받고 내 커밋 ${localOnly.length}개를 그 위로 올림`, "git pull --rebase", { conflicts, rewrites: localOnly });
    }
    const conflicts = predictConflicts(s, [...ancestors(s, r)].filter((c) => !baseAnc.has(c)).flatMap((c) => s.commits[c].files), base, l);
    const id = newId();
    s.commits[id] = { id, msg: `Merge ${remote} into ${branch}`, parents: [l, r], files: [] };
    s.branches[branch] = id;
    return ok(s, `${remote} 를 받아서 ${branch} 에 병합 (merge 커밋)`, "git pull  # merge", { conflicts });
  },

  discard(s0, paths: string[]) {
    const w = s0.working;
    const files = [...w.staged, ...w.unstaged].filter((f) => underAny(f, paths));
    if (!files.length) return fail("버릴 변경이 없습니다.");
    const s = clone(s0);
    s.working.staged = w.staged.filter((f) => !files.includes(f));
    s.working.unstaged = w.unstaged.filter((f) => !files.includes(f));
    return ok(s, `${pathspec(s0, paths)} 의 변경 ${new Set(files).size}개 버리기`, `git restore --staged --worktree -- ${pathspec(s0, paths)}`);
  },

  stashPush(s0, msg?: string) {
    const w = s0.working;
    if (!w.staged.length && !w.unstaged.length) return fail("stash 할 변경이 없습니다.");
    const s = clone(s0);
    s.stash.unshift({ id: newId(), msg: msg || `WIP on ${s.head}`, branch: s.head, staged: w.staged, unstaged: w.unstaged });
    s.working = { staged: [], unstaged: [], conflicted: [] };
    return ok(s, `변경 ${new Set([...w.staged, ...w.unstaged]).size}개를 stash 에 보관`, `git stash push -u${msg ? ` -m "${msg}"` : ""}`);
  },

  stashPop(s0, idx: number, keep = false) {
    const st = s0.stash[idx];
    if (!st) return fail("stash 가 없습니다.");
    const s = clone(s0);
    if (!keep) s.stash.splice(idx, 1);
    return ok(s, `stash "${st.msg}" ${keep ? "적용 (stash 유지)" : "꺼내기"}`, `git stash ${keep ? "apply" : "pop"} stash@{${idx}}`);
  },

  stashDrop(s0, idx: number) {
    const st = s0.stash[idx];
    if (!st) return fail("stash 가 없습니다.");
    const s = clone(s0);
    s.stash.splice(idx, 1);
    return ok(s, `stash "${st.msg}" 삭제`, `git stash drop stash@{${idx}}`);
  },

  tagMove(s0, name: string, id: string) {
    const t = s0.tags?.[name];
    if (!t) return fail("태그가 없습니다.");
    if (t.target === id) return fail("이미 그 커밋에 있습니다.");
    const s = clone(s0);
    s.tags![name] = { ...t, target: id };
    return ok(s, `태그 ${name} 를 ${label(s0, id)} 로 옮기기`, `git tag -f ${name} ${short(id)}`);
  },

  tagDelete(s0, name: string) {
    if (!s0.tags?.[name]) return fail("태그가 없습니다.");
    const s = clone(s0);
    delete s.tags![name];
    return ok(s, `태그 ${name} 삭제 (로컬)`, `git tag -d ${name}`);
  },

  tagPush(s0, name: string) {
    if (!s0.tags?.[name]) return fail("태그가 없습니다.");
    if (!Object.keys(s0.remotes).length && !(s0.remoteList || []).length) return fail("연결된 원격이 없습니다.");
    return ok(clone(s0), `태그 ${name} 를 원격에 올리기`, `git push origin refs/tags/${name}`);
  },

  deleteRemoteBranch(s0, remoteBranch: string) {
    if (!s0.remotes[remoteBranch]) return fail("원격 브랜치가 없습니다.");
    const s = clone(s0);
    delete s.remotes[remoteBranch];
    const [remote, ...rest] = remoteBranch.split("/");
    return ok(s, `원격 브랜치 ${remoteBranch} 삭제`, `git push ${remote} --delete ${rest.join("/")}`);
  },
};

/** 미리보기 계산 (예외가 나도 화면이 멈추지 않게) */
export function preview(op: OpName, s: RepoState, args: unknown[]): PreviewOut {
  const fn = previews[op];
  if (!fn) return fail(`미리보기를 지원하지 않는 조작: ${op}`);
  try {
    return fn(s, ...args);
  } catch (err) {
    console.error(`[preview] ${op} 계산 실패`, err);
    return fail("미리보기를 계산하지 못했습니다.");
  }
}

/** 공유된(push 된) 커밋을 다시 쓰는지 */
export function touchesPushed(s0: RepoState, r: Preview): boolean {
  if (r.force) return true;
  const p = pushedSet(s0);
  return r.rewrites.some((c) => p.has(c));
}
