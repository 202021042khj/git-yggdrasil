// 드래그 문법: (끄는 것, 놓는 곳) → 할 수 있는 조작 목록
// 각 조작은 실제로 보낼 { op, args } 와 미리보기 결과를 함께 갖는다.
import { store } from "@/app/store";
import { branchesAt, isAncestor, ownerBranch, pushedSet, stems, type Stems } from "@/model/graph";
import { isError, preview, type Preview } from "@/model/preview";
import { t } from "@shared/i18n/i18n";
import type { OpName } from "@shared/types/ipc";
import type { RepoState } from "@shared/types/repo";

export type SourceKind = "commit" | "label" | "working" | "file" | "stash" | "remote" | "tag";
export type TargetKind = "commit" | "label" | "gap" | "working" | "trash" | "stash" | "remote" | "canvas";

export interface DragSource {
  kind: SourceKind;
  id?: string;
  branch?: string;
  file?: string;
  stash?: number;
  remote?: string;
  tag?: string;
  /** 여러 커밋을 함께 끌 때 (오래된 것부터) */
  ids?: string[];
}

export interface DropTarget {
  kind: TargetKind;
  id?: string;
  branch?: string;
  index?: number;
  /** 메뉴에 보일 대상 이름 */
  name?: string;
  /** 조작 계산을 미룬다 (라벨에 닿을 때 계산) */
  lazy?: boolean;
}

/** 놓을 때 물어볼 값 */
export interface ActionInput {
  msg?: string;
  name?: string;
}

export interface Action {
  verb: string;
  op: OpName;
  /** 입력값으로 실제 인자를 만든다 */
  build(input: ActionInput): unknown[];
  res: Preview;
  needs?: "msg" | "name";
}

export function actionsFor(src: DragSource, tgt: DropTarget, s: RepoState = store.repo, st: Stems = stems(s)): Action[] {
  if (s.op) return [];
  const out: Action[] = [];
  const add = (verb: string, op: OpName, build: (i: ActionInput) => unknown[], needs?: Action["needs"]) => {
    const res = preview(op, s, build({}));
    if (!isError(res)) out.push({ verb, op, build, res, needs });
  };

  if (src.kind === "commit" && src.ids && src.ids.length > 1) {
    // 여러 커밋: 다른 브랜치에 한꺼번에 복사 (cherry-pick A B C)
    const ids = src.ids;
    let b = tgt.kind === "label" ? tgt.branch : undefined;
    if (tgt.kind === "commit" && tgt.id && !ids.includes(tgt.id)) b = branchesAt(s, tgt.id)[0];
    if (b) add(t("verb.copyMany", { n: ids.length, branch: b }), "cherryPick", () => [ids, b]);
    return out;
  }
  if (src.kind === "commit" && src.id) {
    const id = src.id, own = ownerBranch(s, id, st);
    let target = tgt;
    // 다른 브랜치의 끝 커밋 = 그 브랜치 이름표와 같다
    if (tgt.kind === "commit" && tgt.id && ownerBranch(s, tgt.id, st) !== own) {
      const b = branchesAt(s, tgt.id).find((x) => x !== own);
      if (!b) return [];
      target = { kind: "label", branch: b };
    }
    if (target.kind === "label" && target.branch) {
      const b = target.branch;
      if (b === own) return [];
      add(t("verb.moveTo", { branch: b }), "moveCommit", () => [id, b]);
      add(t("verb.copyTo", { branch: b }), "cherryPick", () => [[id], b]);
      // "이 작업을 저쪽에 합치고 싶다" 는 생각으로 커밋을 끄는 경우: 커밋이 속한 브랜치 전체 merge
      if (own && own !== b) add(t("verb.mergeWhole", { src: own, dst: b }), "merge", () => [own, b]);
    } else if (target.kind === "commit" && target.id && target.id !== id && own) {
      const dst = target.id;
      add(t("verb.squashInto"), "squash", () => [id, dst]);
    } else if (target.kind === "gap" && target.branch !== undefined && target.index !== undefined) {
      const { branch, index } = target;
      add(t("verb.reorderHere"), "reorder", () => [id, branch, index]);
    } else if (target.kind === "working") {
      const parent = s.commits[id].parents[0];
      if (parent && s.head && isAncestor(s, id, s.branches[s.head])) {
        add(t("verb.undoMixed"), "resetHead", () => [parent, "mixed"]);
        add(t("verb.undoSoft"), "resetHead", () => [parent, "soft"]);
      }
    } else if (target.kind === "trash") {
      if (pushedSet(s).has(id)) add(t("verb.revert"), "revertCommit", () => [id]);
      else add(t("verb.drop"), "dropCommit", () => [id]);
    } else if (target.kind === "canvas") {
      add(t("verb.branchHere"), "createBranch", (i) => [i.name || "new-branch", id], "name");
    }
  } else if (src.kind === "label" && src.branch) {
    const b = src.branch;
    if (tgt.kind === "label" && tgt.branch && tgt.branch !== b) {
      const to = tgt.branch;
      add(t("verb.rebaseOnto", { branch: to }), "rebaseStem", () => [b, s.branches[to]]);
      add(t("verb.mergeInto", { branch: to }), "merge", () => [b, to]);
      add(t("verb.movePointerTo", { branch: to }), "moveBranch", () => [b, s.branches[to]]);
    } else if (tgt.kind === "commit" && tgt.id) {
      const x = tgt.id;
      if (b === s.head && x !== s.branches[b] && isAncestor(s, x, s.branches[b])) {
        add(t("verb.resetMixed"), "resetHead", () => [x, "mixed"]);
        add(t("verb.resetSoft"), "resetHead", () => [x, "soft"]);
        add(t("verb.resetHard"), "resetHead", () => [x, "hard"]);
      } else {
        add(t("verb.rebaseHere"), "rebaseStem", () => [b, x]);
        add(t("verb.movePointer"), "moveBranch", () => [b, x]);
      }
    } else if (tgt.kind === "remote") add(t("verb.push"), "push", () => [b]);
    else if (tgt.kind === "trash") add(t("verb.deleteBranch"), "deleteBranch", () => [b]);
  } else if (src.kind === "working" || src.kind === "file") {
    const paths = src.kind === "file" && src.file !== undefined ? [src.file] : undefined;
    const msgOf = (i: ActionInput) => i.msg || t("verb.defaultMsg");
    if (tgt.kind === "label" && tgt.branch) {
      const to = tgt.branch;
      add(src.kind === "file" ? t("verb.commitPath") : t("verb.commitHere"), "commitTo", (i) => [to, msgOf(i), paths], "msg");
    } else if (tgt.kind === "commit" && tgt.id) {
      const x = tgt.id;
      if (ownerBranch(s, x, st) === s.head) add(t("verb.amendInto"), "amendInto", (i) => [x, msgOf(i), paths]);
      else {
        const b = branchesAt(s, x)[0];
        if (b) add(t("verb.commitHere"), "commitTo", (i) => [b, msgOf(i), paths], "msg");
      }
    } else if (tgt.kind === "trash") add(t("verb.discard"), "discard", () => [paths || [""]]);
    else if (tgt.kind === "stash" && src.kind === "working") add(t("verb.stash"), "stashPush", (i) => [i.msg || undefined], "msg");
  } else if (src.kind === "stash" && src.stash !== undefined) {
    const i = src.stash;
    if (tgt.kind === "working") {
      add(t("verb.stashPop"), "stashPop", () => [i, false]);
      add(t("verb.stashApply"), "stashPop", () => [i, true]);
    } else if (tgt.kind === "trash") add(t("verb.stashDrop"), "stashDrop", () => [i]);
  } else if (src.kind === "remote" && src.remote) {
    const r = src.remote;
    if (tgt.kind === "label" && tgt.branch) {
      const to = tgt.branch, own = (s.upstream?.[to] || "origin/" + to) === r;
      add(own ? t("verb.pullMerge") : t("verb.fetchMerge"), "pull", () => [to, "merge", r]);
      add(own ? t("verb.pullRebase") : t("verb.fetchRebase"), "pull", () => [to, "rebase", r]);
    } else if (tgt.kind === "trash") add(t("verb.deleteRemoteBranch"), "deleteRemoteBranch", () => [r]);
  } else if (src.kind === "tag" && src.tag) {
    const name = src.tag;
    if (tgt.kind === "commit" && tgt.id) {
      const x = tgt.id;
      add(t("verb.tagMove"), "tagMove", () => [name, x]);
    } else if (tgt.kind === "trash") add(t("verb.tagDelete"), "tagDelete", () => [name]);
    else if (tgt.kind === "remote") add(t("verb.tagPush"), "tagPush", () => [name]);
  }
  return out;
}

/**
 * 후보 놓는 곳 (DOM 과 무관 — 오른쪽 클릭 메뉴도 이걸 쓴다)
 * opts.commitFilter: 이름표·태그를 끌 때 후보 커밋을 줄인다 (화면에 보이는 것만)
 * opts.commits === false: 커밋 대상을 아예 뺀다 (오른쪽 클릭 메뉴에서 "모든 커밋" 목록은 너무 길다)
 */
export function candidateTargets(src: DragSource, opts: { commitFilter?: (id: string) => boolean; commits?: boolean } = {}, s: RepoState = store.repo, st: Stems = stems(s)): DropTarget[] {
  const out: DropTarget[] = [];
  Object.keys(s.branches).forEach((b) => out.push({ kind: "label", branch: b, name: b }));
  if (src.kind === "commit" && src.id) {
    const own = ownerBranch(s, src.id, st);
    if (own) {
      const ids = st.stems[own].ids;
      ids.forEach((c) => c !== src.id && out.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"` }));
      ids.forEach((_, i) => out.push({ kind: "gap", branch: own, index: i, name: t("target.position", { n: i + 1 }) }));
      out.push({ kind: "gap", branch: own, index: ids.length, name: t("target.end") });
    }
    out.push({ kind: "canvas", name: t("target.canvas") });
  }
  if ((src.kind === "label" || src.kind === "tag") && opts.commits !== false) {
    const ownTip = src.kind === "label" ? s.branches[src.branch!] : s.tags?.[src.tag!]?.target;
    for (const c of st.owner.keys()) {
      if (c === ownTip) continue; // 자기 자리에는 놓을 일이 없다
      if (!opts.commitFilter || opts.commitFilter(c)) out.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"`, lazy: src.kind === "label" });
    }
  }
  if (src.kind === "working" || src.kind === "file") {
    st.stems[s.head]?.ids.forEach((c) => out.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"` }));
  }
  out.push({ kind: "working", name: t("target.working") }, { kind: "trash", name: t("target.trash") }, { kind: "stash", name: "stash" }, { kind: "remote", name: "origin" });
  return out;
}

/** 이름표 → 커밋 대상의 라벨 문구 (미리보기를 계산하지 않고 정한다) */
export function quickLabelVerb(src: DragSource, c: string, s: RepoState = store.repo): string {
  const b = src.branch!;
  return b === s.head && c !== s.branches[b] && isAncestor(s, c, s.branches[b]) ? t("verb.resetHereQuick") : t("verb.rebaseHere");
}

/** 끄는 것의 이름 (드래그 중 커서 옆, 메뉴 제목) */
export function sourceLabel(src: DragSource, s: RepoState = store.repo): string {
  switch (src.kind) {
    case "commit": return src.ids && src.ids.length > 1 ? t("src.commits", { n: src.ids.length }) : s.commits[src.id!]?.msg ?? "";
    case "label": return src.branch!;
    case "file": return src.file || t("src.allChanges");
    case "working": return s.working.staged.length ? t("src.staged", { n: s.working.staged.length }) : t("src.allUnstaged", { n: s.working.unstaged.length });
    case "stash": return `stash@{${src.stash}}`;
    case "remote": return src.remote!;
    case "tag": return t("src.tag", { name: src.tag! });
  }
}

export function sourceFromElement(el: HTMLElement): DragSource {
  const d = el.dataset;
  return {
    kind: d.drag as SourceKind,
    id: d.id,
    branch: d.branch,
    file: d.file,
    stash: d.stash !== undefined ? Number(d.stash) : undefined,
    remote: d.remote,
    tag: d.tag,
  };
}
