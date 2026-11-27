// 미리보기 엔진: 조작을 놓기 전에 "결과가 어떻게 보일지" 를 메모리에서 계산한다.
// 실제 실행은 메인 프로세스가 git 으로 한다 (같은 조작 이름·인자를 그대로 보낸다).
// 충돌은 "같은 파일을 양쪽이 고쳤는가" 로만 예상한다. 실제 충돌은 실행할 때 git 이 판단한다.
import { short } from "@/lib/html";
import { pathspec, underAny } from "@/lib/paths";
import { ancestors, generations, isAncestor, mergeBase, ownerBranch, pushedSet, stems } from "@/model/graph";
import { t } from "@shared/i18n/i18n";
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

/** keep: 그대로 다시 올릴 커밋 · 아니면 msg/files 로 새로 만든다. side: 첫 부모 말고 이어 줄 부모 (merge 커밋) */
interface Spec { keep?: string; msg?: string; files?: string[]; side?: string[] }

const isMerge = (s: RepoState, id: string) => s.commits[id].parents.length > 1;

/** specs 를 onto 위에 차례로 새 커밋으로 만든다. merge 커밋은 merge 로 (첫 부모만 바꾸고 곁가지 부모는 그대로) */
function replay(s: RepoState, specs: Spec[], onto: string | null): string | null {
  let tip = onto;
  for (const sp of specs) {
    const src = sp.keep ? s.commits[sp.keep] : { msg: sp.msg ?? "", files: sp.files ?? [] };
    const side = sp.side ?? (sp.keep ? s.commits[sp.keep].parents.slice(1) : []);
    const id = newId();
    s.commits[id] = { id, msg: src.msg, parents: [...(tip ? [tip] : []), ...side], files: [...src.files] };
    tip = id;
  }
  return tip;
}

/** merge 커밋 너머로 순서를 바꿨는지 (merge 커밋끼리의 순서 · merge 앞뒤 구간이 그대로여야 한다) */
function crossesMerge(s: RepoState, stem: string[], order: string[]): boolean {
  const key = new Map<string, number>();
  let k = 0;
  for (const id of stem) {
    if (isMerge(s, id)) { key.set(id, ++k); k++; } else key.set(id, k);
  }
  return order.some((id, i) => i > 0 && key.get(id)! < key.get(order[i - 1])!);
}

/** 줄기에 merge 커밋이 있으면 git 명령에 붙일 옵션 */
const mergesFlag = (s: RepoState, ids: string[]) => (ids.some((id) => isMerge(s, id)) ? " --rebase-merges" : "");

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
    const ch = takeChanges(s, paths);
    if (!ch) return fail(paths ? t("pv.noPathChanges") : t("pv.noChanges"));
    const tip = branch === "HEAD" ? s.detached ?? null : s.branches[branch];
    const id = replay(s, [{ msg, files: ch.files }], tip)!;
    if (branch === "HEAD") s.detached = id;
    else s.branches[branch] = id;
    const other = branch !== s.head && branch !== "HEAD";
    return ok(s, t("pv.commitTo", { branch, other, n: ch.files.length, all: ch.all }),
      ch.addCmd + `git commit -m "${msg}"${ch.suffix}`);
  },

  amendInto(s0, id: string, _msg: string, paths?: string[]) {
    const br = ownerBranch(s0, id);
    if (br !== s0.head) return fail(t("pv.amendOnlyHead"));
    const s = clone(s0);
    const ch = takeChanges(s, paths);
    if (!ch) return fail(t("pv.noAmendChanges"));
    const isTip = s.branches[br] === id;
    const specs = stems(s).stems[br].ids.map((c): Spec => (c === id ? { msg: s.commits[c].msg, files: [...s.commits[c].files, ...ch.files], side: s.commits[c].parents.slice(1) } : { keep: c }));
    const rewrites = rewriteStem(s, br, specs);
    return ok(s, isTip ? t("pv.amendTip", { commit: label(s0, id) }) : t("pv.fixupPast", { commit: label(s0, id) }),
      ch.addCmd + (isTip ? `git commit --amend${ch.suffix}` : `git commit --fixup ${short(id)}${ch.suffix} && git rebase -i --autosquash`), { rewrites });
  },

  cherryPick(s0, ids: string[], branch: string) {
    const s = clone(s0);
    const tip = s.branches[branch];
    if (ids.some((id) => isAncestor(s, id, tip))) return fail(t("pv.alreadyIn", { branch }));
    const conflicts = predictConflicts(s, ids.flatMap((id) => s.commits[id].files), s.commits[ids[0]].parents[0] ?? null, tip);
    s.branches[branch] = replay(s, ids.map((id) => ({ keep: id })), tip)!;
    return ok(s, t("pv.cherryPick", { commits: ids.map((i) => label(s0, i)).join(", "), branch }), `git cherry-pick ${ids.map(short).join(" ")}  # → ${branch}`, { conflicts });
  },

  moveCommit(s0, id: string, branch: string) {
    const src = ownerBranch(s0, id);
    if (!src) return fail(t("pv.moveOnlyLocal"));
    if (src === branch) return fail(t("pv.moveSameBranch"));
    const r = previews.cherryPick!(s0, [id], branch);
    if (isError(r)) return r;
    const s = r.state;
    const specs = stems(s).stems[src].ids.filter((c) => c !== id).map((c) => ({ keep: c }));
    const rewrites = rewriteStem(s, src, specs);
    return ok(s, t("pv.moveCommit", { commit: label(s0, id), from: src, to: branch }),
      `git cherry-pick ${short(id)}  # → ${branch}\ngit rebase --onto ${short(id)}~1 ${short(id)} ${src}`, { conflicts: r.conflicts, rewrites: [id, ...rewrites] });
  },

  dropCommit(s0, id: string) {
    const br = ownerBranch(s0, id);
    if (!br) return fail(t("pv.dropOnlyLocal"));
    const s = clone(s0);
    const rest = stems(s).stems[br].ids.filter((c) => c !== id);
    if (!rest.length && !s0.commits[id].parents.length) return fail(t("pv.planDropAll"));
    const rewrites = rewriteStem(s, br, rest.map((c) => ({ keep: c })));
    const flag = mergesFlag(s0, rest);
    return ok(s, t("pv.drop", { commit: label(s0, id), branch: br }),
      s0.commits[id].parents.length ? `git rebase${flag} --onto ${short(id)}~1 ${short(id)} ${br}` : `git rebase -i${flag} --root ${br}  # drop ${short(id)}`, { rewrites });
  },

  revertCommit(s0, id: string) {
    if (!isAncestor(s0, id, s0.branches[s0.head])) return fail(t("pv.revertOnlyHead", { branch: s0.head }));
    const s = clone(s0);
    const c = s.commits[id];
    s.branches[s.head] = replay(s, [{ msg: `Revert "${c.msg}"`, files: c.files }], s.branches[s.head])!;
    return ok(s, t("pv.revert"), `git revert ${short(id)}`);
  },

  squash(s0, src: string, dst: string) {
    const br = ownerBranch(s0, src);
    if (!br || br !== ownerBranch(s0, dst)) return fail(t("pv.squashSameStem"));
    if (isMerge(s0, src)) return fail(t("pv.mergeSquash"));
    const s = clone(s0);
    const specs: Spec[] = [];
    const ids = stems(s).stems[br].ids;
    for (const c of ids) {
      if (c === src) continue;
      specs.push(c === dst ? { msg: s.commits[dst].msg, files: [...s.commits[dst].files, ...s.commits[src].files], side: s.commits[dst].parents.slice(1) } : { keep: c });
    }
    const lo = Math.min(ids.indexOf(src), ids.indexOf(dst));
    const order = ids.filter((c) => c !== src).flatMap((c) => (c === dst ? [c, src] : [c]));
    if (crossesMerge(s, ids.slice(lo), order.slice(lo))) return fail(t("pv.mergeOrder"));
    const rewrites = rewriteStem(s, br, specs);
    return ok(s, t("pv.squash", { src: label(s0, src), dst: label(s0, dst) }), `git rebase -i${mergesFlag(s0, ids)}  # fixup ${short(src)} → ${short(dst)}`, { rewrites });
  },

  /** 커밋 정리(interactive rebase): 위에서부터 오래된 커밋 */
  rebasePlan(s0, branch: string, steps: RebaseStep[]) {
    const st = stems(s0).stems[branch];
    if (!st) return fail(t("pv.planOnlyLocal"));
    if (steps.length !== st.ids.length || !steps.every((x) => st.ids.includes(x.id))) return fail(t("pv.planMismatch"));
    const kept = steps.filter((x) => x.action !== "drop");
    if (!kept.length) return fail(t("pv.planDropAll"));
    if (kept[0].action === "squash" || kept[0].action === "fixup") return fail(t("pv.planFirstSquash"));
    if (steps.some((x) => (x.action === "reword" || x.action === "squash") && !(x.msg ?? "").trim())) return fail(t("pv.planEmptyMsg"));
    if (kept.some((x) => (x.action === "squash" || x.action === "fixup") && isMerge(s0, x.id))) return fail(t("pv.mergeSquash"));
    if (crossesMerge(s0, st.ids, kept.map((x) => x.id))) return fail(t("pv.mergeOrder"));
    const s = clone(s0);
    const specs: Spec[] = [];
    for (const x of kept) {
      const c = s.commits[x.id];
      const last = specs[specs.length - 1];
      if ((x.action === "squash" || x.action === "fixup") && last) {
        const files = [...(last.files ?? s.commits[last.keep!].files), ...c.files];
        const side = last.side ?? s.commits[last.keep!].parents.slice(1);
        specs[specs.length - 1] = { msg: x.action === "squash" ? x.msg! : last.msg ?? s.commits[last.keep!].msg, files: [...new Set(files)], side };
      } else if (x.action === "reword") specs.push({ msg: x.msg!, files: [...c.files], side: c.parents.slice(1) });
      else specs.push({ keep: x.id });
    }
    const same = specs.length === st.ids.length && specs.every((sp, i) => sp.keep === st.ids[i]);
    if (same) return fail(t("pv.planNoChange"));
    // 순서를 바꾼 커밋이 같은 파일을 건드리면 충돌할 수 있다
    const moved = kept.filter((x, i) => st.ids.filter((id) => kept.some((k) => k.id === id))[i] !== x.id);
    const seen = new Map<string, number>();
    moved.forEach((x) => s0.commits[x.id].files.forEach((f) => seen.set(f, (seen.get(f) ?? 0) + 1)));
    const dropped = steps.filter((x) => x.action === "drop");
    const later = new Set(kept.flatMap((x) => s0.commits[x.id].files));
    const conflicts = [...new Set([...[...seen].filter(([, n]) => n > 1).map(([f]) => f), ...dropped.flatMap((x) => s0.commits[x.id].files.filter((f) => later.has(f)))])];
    const rewrites = rewriteStem(s, branch, specs);
    const counts = (["reword", "squash", "fixup", "drop"] as const).map((a) => [a, steps.filter((x) => x.action === a).length] as const).filter(([, n]) => n);
    const parts = [moved.length ? t("pv.plan.reorder") : "", ...counts.map(([a, n]) => t(`pv.plan.${a}`, { n }))].filter(Boolean);
    return ok(s, t("pv.plan", { branch, parts: parts.join(", ") }), `git rebase -i${mergesFlag(s0, st.ids)} ${st.base ? short(st.base) : "--root"}  # ${branch}`, { conflicts, rewrites });
  },

  reorder(s0, id: string, branch: string, index: number) {
    if (ownerBranch(s0, id) !== branch) return fail(t("pv.reorderSameBranch"));
    const s = clone(s0);
    const ids = stems(s).stems[branch].ids;
    const from = ids.indexOf(id);
    if (index === from || index === from + 1) return fail(t("pv.samePlace"));
    const order = ids.filter((c) => c !== id);
    order.splice(index > from ? index - 1 : index, 0, id);
    if (crossesMerge(s, ids, order)) return fail(t("pv.mergeOrder"));
    const rewrites = rewriteStem(s, branch, order.map((c) => ({ keep: c })));
    return ok(s, t("pv.reorder", { commit: label(s0, id) }), `git rebase -i${mergesFlag(s0, ids)}  # move ${short(id)}`, { rewrites });
  },

  rebaseStem(s0, branch: string, onto: string) {
    const st = stems(s0).stems[branch];
    if (!st?.ids.length) return fail(t("pv.noCommitsToMove"));
    if (st.base === onto) return fail(t("pv.alreadyOnto"));
    if (st.ids.includes(onto)) return fail(t("pv.ontoSelf"));
    const s = clone(s0);
    const conflicts = predictConflicts(s, st.ids.flatMap((c) => s.commits[c].files), st.base, onto);
    s.branches[branch] = replay(s, st.ids.map((c) => ({ keep: c })), onto)!;
    return ok(s, t("pv.rebase", { branch, n: st.ids.length, onto: label(s0, onto) }),
      `git rebase${mergesFlag(s0, st.ids)} --onto ${short(onto)} ${st.base ? short(st.base) : "--root"} ${branch}`, { conflicts, rewrites: st.ids });
  },

  merge(s0, src: string, dst: string) {
    if (src === dst) return fail(t("pv.sameBranch"));
    const s = clone(s0);
    const a = s.branches[dst], b = s.branches[src];
    if (isAncestor(s, b, a)) return fail(t("pv.alreadyMerged", { src, dst }));
    if (isAncestor(s, a, b)) {
      s.branches[dst] = b;
      return ok(s, t("pv.fastForward", { src, dst }), `git merge ${src}  # fast-forward`);
    }
    const base = mergeBase(s, a, b);
    const baseAnc = ancestors(s, base);
    const conflicts = predictConflicts(s, [...ancestors(s, b)].filter((c) => !baseAnc.has(c)).flatMap((c) => s.commits[c].files), base, a);
    const id = newId();
    s.commits[id] = { id, msg: `Merge ${src} into ${dst}`, parents: [a, b], files: [] };
    s.branches[dst] = id;
    return ok(s, t("pv.merge", { src, dst }), `git merge ${src}  # → ${dst}`, { conflicts });
  },

  moveBranch(s0, branch: string, id: string) {
    const s = clone(s0);
    const old = s.branches[branch];
    if (old === id) return fail(t("pv.alreadyThere"));
    const keep = ancestors(s, id);
    const rewrites = [...ancestors(s, old)].filter((c) => !keep.has(c));
    s.branches[branch] = id;
    return ok(s, t("pv.moveBranch", { branch, commit: label(s0, id), dropped: rewrites.length }),
      branch === s.head ? `git reset --keep ${short(id)}` : `git branch -f ${branch} ${short(id)}`, { rewrites });
  },

  resetHead(s0, id: string, mode: "soft" | "mixed" | "hard" = "mixed") {
    const br = s0.head, tip = s0.branches[br];
    if (tip === id) return fail(t("pv.alreadyThere"));
    if (!isAncestor(s0, id, tip)) return fail(t("pv.resetOnlyPast"));
    const s = clone(s0);
    const keep = ancestors(s, id);
    const removed = [...ancestors(s, tip)].filter((c) => !keep.has(c));
    const files = [...new Set(removed.flatMap((c) => s.commits[c].files))];
    const w = s.working;
    if (mode === "soft") { w.staged = [...new Set([...w.staged, ...files])]; w.unstaged = w.unstaged.filter((f) => !w.staged.includes(f)); }
    else if (mode === "mixed") { w.unstaged = [...new Set([...w.staged, ...w.unstaged, ...files])]; w.staged = []; }
    else { w.unstaged = []; w.staged = []; }
    s.branches[br] = id;
    return ok(s, t(`pv.reset.${mode}`, { n: removed.length }), `git reset --${mode} ${short(id)}`, { rewrites: removed });
  },

  createBranch(s0, name: string, id: string) {
    if (!name) return fail(t("pv.noName"));
    if (s0.branches[name]) return fail(t("pv.branchExists", { name }));
    const s = clone(s0);
    s.branches[name] = id;
    s.born = { ...(s.born || {}), [name]: Object.keys(s.born || {}).length + 1 };
    return ok(s, t("pv.createBranch", { commit: label(s0, id), name }), `git branch ${name} ${short(id)}`);
  },

  deleteBranch(s0, name: string) {
    if (name === s0.head) return fail(t("pv.deleteHead"));
    const s = clone(s0);
    const tip = s.branches[name];
    delete s.branches[name];
    const merged = [...Object.values(s.branches), ...Object.values(s.remotes)].some((t) => isAncestor(s, tip, t));
    if (!merged) return fail(t("pv.deleteUnmerged", { name }));
    return ok(s, t("pv.deleteBranch", { name }), `git branch -d ${name}`);
  },

  push(s0, branch: string) {
    const s = clone(s0);
    const r = s.upstream?.[branch] || "origin/" + branch;
    const remote = s.remotes[r];
    const local = s.branches[branch];
    if (remote === local) return fail(t("pv.upToDate"));
    const force = !!remote && !isAncestor(s, remote, local);
    s.remotes[r] = local;
    return ok(s, force ? t("pv.pushForce", { branch }) : remote ? t("pv.push", { branch }) : t("pv.publish", { branch }),
      force ? `git push --force-with-lease` : remote ? "git push" : `git push -u origin ${branch}`, { force });
  },

  pull(s0, branch: string, mode: "merge" | "rebase" = "merge", remote = s0.upstream?.[branch] || "origin/" + branch) {
    const r = s0.remotes[remote], l = s0.branches[branch];
    if (!r) return fail(t("pv.noUpstream", { branch, remote }));
    if (isAncestor(s0, r, l)) return fail(t("pv.nothingToPull"));
    const other = branch !== s0.head; // 체크아웃 안 한 브랜치: 작업 폴더 없이 브랜치만 옮긴다
    const s = clone(s0);
    if (isAncestor(s, l, r)) {
      s.branches[branch] = r;
      return ok(s, t("pv.pullFf", { remote, branch }), other ? `git fetch && git branch -f ${branch} ${remote}` : "git pull  # fast-forward");
    }
    const base = mergeBase(s, l, r);
    const baseAnc = ancestors(s, base);
    const g = generations(s);
    const localOnly = [...ancestors(s, l)].filter((c) => !baseAnc.has(c)).sort((a, b) => g[a] - g[b]);
    if (mode === "rebase") {
      const conflicts = predictConflicts(s, localOnly.flatMap((c) => s.commits[c].files), base, r);
      s.branches[branch] = replay(s, localOnly.map((c) => ({ keep: c })), r)!;
      return ok(s, t("pv.pullRebase", { remote, n: localOnly.length }), other ? `git fetch && git rebase ${remote} ${branch}` : "git pull --rebase", { conflicts, rewrites: localOnly });
    }
    const conflicts = predictConflicts(s, [...ancestors(s, r)].filter((c) => !baseAnc.has(c)).flatMap((c) => s.commits[c].files), base, l);
    const id = newId();
    s.commits[id] = { id, msg: `Merge ${remote} into ${branch}`, parents: [l, r], files: [] };
    s.branches[branch] = id;
    return ok(s, t("pv.pullMerge", { remote, branch }), other ? `git fetch && git merge ${remote}  # into ${branch}` : "git pull  # merge", { conflicts });
  },

  discard(s0, paths: string[]) {
    const w = s0.working;
    const files = [...w.staged, ...w.unstaged].filter((f) => underAny(f, paths));
    if (!files.length) return fail(t("pv.noDiscard"));
    const s = clone(s0);
    s.working.staged = w.staged.filter((f) => !files.includes(f));
    s.working.unstaged = w.unstaged.filter((f) => !files.includes(f));
    return ok(s, t("pv.discard", { path: pathspec(s0, paths), n: new Set(files).size }), `git restore --staged --worktree -- ${pathspec(s0, paths)}`);
  },

  stashPush(s0, msg?: string) {
    const w = s0.working;
    if (!w.staged.length && !w.unstaged.length) return fail(t("pv.noStash"));
    const s = clone(s0);
    s.stash.unshift({ id: newId(), msg: msg || `WIP on ${s.head}`, branch: s.head, staged: w.staged, unstaged: w.unstaged });
    s.working = { staged: [], unstaged: [], conflicted: [] };
    return ok(s, t("pv.stashPush", { n: new Set([...w.staged, ...w.unstaged]).size }), `git stash push -u${msg ? ` -m "${msg}"` : ""}`);
  },

  stashPop(s0, idx: number, keep = false) {
    const st = s0.stash[idx];
    if (!st) return fail(t("pv.stashMissing"));
    const s = clone(s0);
    if (!keep) s.stash.splice(idx, 1);
    return ok(s, keep ? t("pv.stashApply", { msg: st.msg }) : t("pv.stashPop", { msg: st.msg }), `git stash ${keep ? "apply" : "pop"} stash@{${idx}}`);
  },

  stashDrop(s0, idx: number) {
    const st = s0.stash[idx];
    if (!st) return fail(t("pv.stashMissing"));
    const s = clone(s0);
    s.stash.splice(idx, 1);
    return ok(s, t("pv.stashDrop", { msg: st.msg }), `git stash drop stash@{${idx}}`);
  },

  tagMove(s0, name: string, id: string) {
    const tag = s0.tags?.[name];
    if (!tag) return fail(t("pv.noTag"));
    if (tag.target === id) return fail(t("pv.tagAlreadyThere"));
    const s = clone(s0);
    s.tags![name] = { ...tag, target: id };
    return ok(s, t("pv.tagMove", { name, commit: label(s0, id) }), `git tag -f ${name} ${short(id)}`);
  },

  tagDelete(s0, name: string) {
    if (!s0.tags?.[name]) return fail(t("pv.noTag"));
    const s = clone(s0);
    delete s.tags![name];
    return ok(s, t("pv.tagDelete", { name }), `git tag -d ${name}`);
  },

  tagPush(s0, name: string) {
    if (!s0.tags?.[name]) return fail(t("pv.noTag"));
    if (!Object.keys(s0.remotes).length && !(s0.remoteList || []).length) return fail(t("pv.noRemote"));
    return ok(clone(s0), t("pv.tagPush", { name }), `git push origin refs/tags/${name}`);
  },

  deleteRemoteBranch(s0, remoteBranch: string) {
    if (!s0.remotes[remoteBranch]) return fail(t("pv.noRemoteBranch"));
    const s = clone(s0);
    delete s.remotes[remoteBranch];
    const [remote, ...rest] = remoteBranch.split("/");
    return ok(s, t("pv.deleteRemoteBranch", { name: remoteBranch }), `git push ${remote} --delete ${rest.join("/")}`);
  },
};

/** 미리보기 계산 (예외가 나도 화면이 멈추지 않게) */
export function preview(op: OpName, s: RepoState, args: unknown[]): PreviewOut {
  const fn = previews[op];
  if (!fn) return fail(t("pv.unsupported", { op }));
  try {
    return fn(s, ...args);
  } catch (err) {
    console.error(`[preview] ${op} failed`, err);
    return fail(t("pv.failed"));
  }
}

/** 공유된(push 된) 커밋을 다시 쓰는지 */
export function touchesPushed(s0: RepoState, r: Preview): boolean {
  if (r.force) return true;
  const p = pushedSet(s0);
  return r.rewrites.some((c) => p.has(c));
}
