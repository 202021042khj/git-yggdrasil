// 드래그 문법: (끄는 것, 놓는 곳) → 할 수 있는 조작 목록
// 각 조작은 실제로 보낼 { op, args } 와 미리보기 결과를 함께 갖는다.
import { store } from "@/app/store";
import { branchesAt, isAncestor, ownerBranch, pushedSet, stems, type Stems } from "@/model/graph";
import { isError, preview, type Preview } from "@/model/preview";
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
      add(`${b} 브랜치로 옮기기`, "moveCommit", () => [id, b]);
      add(`${b} 브랜치에 복사`, "cherryPick", () => [[id], b]);
      // "이 작업을 저쪽에 합치고 싶다" 는 생각으로 커밋을 끄는 경우: 커밋이 속한 브랜치 전체 merge
      if (own && own !== b) add(`${own} 브랜치 전체를 ${b}에 합치기`, "merge", () => [own, b]);
    } else if (target.kind === "commit" && target.id && target.id !== id && own) {
      const dst = target.id;
      add("이 커밋에 합치기", "squash", () => [id, dst]);
    } else if (target.kind === "gap" && target.branch !== undefined && target.index !== undefined) {
      const { branch, index } = target;
      add("여기로 순서 옮기기", "reorder", () => [id, branch, index]);
    } else if (target.kind === "working") {
      const parent = s.commits[id].parents[0];
      if (parent && s.head && isAncestor(s, id, s.branches[s.head])) {
        add("커밋 취소, 변경은 작업 영역으로", "resetHead", () => [parent, "mixed"]);
        add("커밋 취소, 변경은 Staged로", "resetHead", () => [parent, "soft"]);
      }
    } else if (target.kind === "trash") {
      if (pushedSet(s).has(id)) add("되돌림 커밋 만들기", "revertCommit", () => [id]);
      else add("커밋 제거", "dropCommit", () => [id]);
    } else if (target.kind === "canvas") {
      add("여기서 새 브랜치", "createBranch", (i) => [i.name || "new-branch", id], "name");
    }
  } else if (src.kind === "label" && src.branch) {
    const b = src.branch;
    if (tgt.kind === "label" && tgt.branch && tgt.branch !== b) {
      const t = tgt.branch;
      add(`${t} 위로 올리기`, "rebaseStem", () => [b, s.branches[t]]);
      add(`${t} 브랜치에 합치기`, "merge", () => [b, t]);
      add(`${t} 위치로 포인터만 옮기기`, "moveBranch", () => [b, s.branches[t]]);
    } else if (tgt.kind === "commit" && tgt.id) {
      const x = tgt.id;
      if (b === s.head && x !== s.branches[b] && isAncestor(s, x, s.branches[b])) {
        add("여기로 되돌리기, 변경은 작업 영역으로", "resetHead", () => [x, "mixed"]);
        add("여기로 되돌리기, 변경은 Staged로", "resetHead", () => [x, "soft"]);
        add("여기로 되돌리기, 변경 버림", "resetHead", () => [x, "hard"]);
      } else {
        add("이 커밋 위로 올리기", "rebaseStem", () => [b, x]);
        add("포인터만 옮기기", "moveBranch", () => [b, x]);
      }
    } else if (tgt.kind === "remote") add("push", "push", () => [b]);
    else if (tgt.kind === "trash") add("브랜치 삭제", "deleteBranch", () => [b]);
  } else if (src.kind === "working" || src.kind === "file") {
    const paths = src.kind === "file" && src.file !== undefined ? [src.file] : undefined;
    const msgOf = (i: ActionInput) => i.msg || "새 커밋";
    if (tgt.kind === "label" && tgt.branch) {
      const t = tgt.branch;
      add(src.kind === "file" ? "이 경로만 커밋" : "여기에 커밋", "commitTo", (i) => [t, msgOf(i), paths], "msg");
    } else if (tgt.kind === "commit" && tgt.id) {
      const x = tgt.id;
      if (ownerBranch(s, x, st) === s.head) add("이 커밋에 합치기", "amendInto", (i) => [x, msgOf(i), paths]);
      else {
        const b = branchesAt(s, x)[0];
        if (b) add("여기에 커밋", "commitTo", (i) => [b, msgOf(i), paths], "msg");
      }
    } else if (tgt.kind === "trash") add("변경 버리기", "discard", () => [paths || [""]]);
    else if (tgt.kind === "stash" && src.kind === "working") add("stash에 보관", "stashPush", (i) => [i.msg || undefined], "msg");
  } else if (src.kind === "stash" && src.stash !== undefined) {
    const i = src.stash;
    if (tgt.kind === "working") {
      add("stash 꺼내기", "stashPop", () => [i, false]);
      add("적용만 하고 stash 유지", "stashPop", () => [i, true]);
    } else if (tgt.kind === "trash") add("stash 삭제", "stashDrop", () => [i]);
  } else if (src.kind === "remote" && src.remote) {
    const r = src.remote;
    if (tgt.kind === "label" && tgt.branch) {
      const t = tgt.branch, own = (s.upstream?.[t] || "origin/" + t) === r;
      add(own ? "pull (merge)" : "가져와 합치기", "pull", () => [t, "merge", r]);
      add(own ? "pull (rebase)" : "가져와 그 위로 올리기", "pull", () => [t, "rebase", r]);
    } else if (tgt.kind === "trash") add("원격 브랜치 삭제", "deleteRemoteBranch", () => [r]);
  } else if (src.kind === "tag" && src.tag) {
    const name = src.tag;
    if (tgt.kind === "commit" && tgt.id) {
      const x = tgt.id;
      add("태그 옮기기", "tagMove", () => [name, x]);
    } else if (tgt.kind === "trash") add("태그 삭제", "tagDelete", () => [name]);
    else if (tgt.kind === "remote") add("태그 push", "tagPush", () => [name]);
  }
  return out;
}

/**
 * 후보 놓는 곳 (DOM 과 무관 — 오른쪽 클릭 메뉴도 이걸 쓴다)
 * opts.commitFilter: 이름표·태그를 끌 때 후보 커밋을 줄인다 (화면에 보이는 것만)
 * opts.commits === false: 커밋 대상을 아예 뺀다 (오른쪽 클릭 메뉴에서 "모든 커밋" 목록은 너무 길다)
 */
export function candidateTargets(src: DragSource, opts: { commitFilter?: (id: string) => boolean; commits?: boolean } = {}, s: RepoState = store.repo, st: Stems = stems(s)): DropTarget[] {
  const t: DropTarget[] = [];
  Object.keys(s.branches).forEach((b) => t.push({ kind: "label", branch: b, name: b }));
  if (src.kind === "commit" && src.id) {
    const own = ownerBranch(s, src.id, st);
    if (own) {
      const ids = st.stems[own].ids;
      ids.forEach((c) => c !== src.id && t.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"` }));
      ids.forEach((_, i) => t.push({ kind: "gap", branch: own, index: i, name: `${i + 1}번째 자리` }));
      t.push({ kind: "gap", branch: own, index: ids.length, name: "맨 끝" });
    }
    t.push({ kind: "canvas", name: "빈 곳" });
  }
  if ((src.kind === "label" || src.kind === "tag") && opts.commits !== false) {
    const ownTip = src.kind === "label" ? s.branches[src.branch!] : s.tags?.[src.tag!]?.target;
    for (const c of st.owner.keys()) {
      if (c === ownTip) continue; // 자기 자리에는 놓을 일이 없다
      if (!opts.commitFilter || opts.commitFilter(c)) t.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"`, lazy: src.kind === "label" });
    }
  }
  if (src.kind === "working" || src.kind === "file") {
    st.stems[s.head]?.ids.forEach((c) => t.push({ kind: "commit", id: c, name: `"${s.commits[c].msg}"` }));
  }
  t.push({ kind: "working", name: "작업 영역" }, { kind: "trash", name: "휴지통" }, { kind: "stash", name: "stash" }, { kind: "remote", name: "origin" });
  return t;
}

/** 이름표 → 커밋 대상의 라벨 문구 (미리보기를 계산하지 않고 정한다) */
export function quickLabelVerb(src: DragSource, c: string, s: RepoState = store.repo): string {
  const b = src.branch!;
  return b === s.head && c !== s.branches[b] && isAncestor(s, c, s.branches[b]) ? "여기로 되돌리기" : "이 커밋 위로 올리기";
}

/** 끄는 것의 이름 (드래그 중 커서 옆, 메뉴 제목) */
export function sourceLabel(src: DragSource, s: RepoState = store.repo): string {
  switch (src.kind) {
    case "commit": return s.commits[src.id!]?.msg ?? "";
    case "label": return src.branch!;
    case "file": return src.file || "변경 전체";
    case "working": return s.working.staged.length ? `Staged ${s.working.staged.length}개` : `변경 ${s.working.unstaged.length}개 전체`;
    case "stash": return `stash@{${src.stash}}`;
    case "remote": return src.remote!;
    case "tag": return `태그 ${src.tag}`;
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
