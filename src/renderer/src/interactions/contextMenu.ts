// 오른쪽 클릭 메뉴: 드래그 없이 같은 조작을 고른다 (WCAG 2.2 Dragging Movements)
// + 드래그로는 표현하기 어려운 조작 (이름 바꾸기, 태그 달기, 커밋 나누기 등)
import { blocked, run } from "@/app/actions";
import { store } from "@/app/store";
import { short } from "@/lib/html";
import { isAncestor, stems } from "@/model/graph";
import { actionMenuItem, hideInCanvas, withSelection } from "@/interactions/drag";
import { actionsFor, candidateTargets, sourceFromElement, sourceLabel, type DragSource } from "@/interactions/targets";
import { addWorktree } from "@/components/pages/main/sections/sidebar/extrasUtils";
import { openRebaseEditor } from "@/components/pages/main/sections/dialogs/rebaseUtils";
import { open } from "@/app/repoSession";
import { askText, confirmAction } from "@/components/ui/dialogUtils";
import { openMenu, type MenuItem } from "@/components/ui/menuUtils";
import { toast } from "@/components/ui/toastUtils";

/** 메뉴 항목을 더하는 곳 (예: GitHub PR 만들기). 섹션이 등록한다 */
export type ContextProvider = (src: DragSource) => MenuItem[];
const providers: ContextProvider[] = [];
export const registerContextProvider = (p: ContextProvider) => { providers.push(p); };

/** 실행이 미리보기 없이 바로 git 조작인 항목 */
const direct = (label: string, cmd: string, onPick: () => void): MenuItem => ({ label, cmd, onPick });

function dragActionItems(src: DragSource): MenuItem[] {
  const s = store.repo, st = stems(s);
  const items: MenuItem[] = [];
  const seen = new Set<string>();
  for (const tgt of candidateTargets(src, { commits: src.kind !== "label" && src.kind !== "tag" }, s, st)) {
    if (tgt.kind === "label" && src.kind === "label" && tgt.branch === src.branch) continue;
    if (tgt.kind === "canvas") continue;
    for (const a of actionsFor(src, tgt, s, st)) {
      const named = a.verb.includes(tgt.name || "\u0000") || ["working", "trash", "stash", "remote"].includes(tgt.kind);
      const label = named ? a.verb : `${a.verb} — ${tgt.name}`;
      const key = `${a.res.cmd}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(actionMenuItem(src, a, label));
    }
  }
  return items;
}

/** 드래그와 상관없이 항목 종류별로 붙는 조작 */
function extraItems(src: DragSource): MenuItem[] {
  const s = store.repo;
  const items: MenuItem[] = [];
  if (src.ids && src.ids.length > 1) {
    items.push(direct("선택 풀기", "", () => store.update({ multi: [] })));
    return items;
  }
  if (src.kind === "commit" && src.id) {
    const id = src.id;
    items.push(direct("여기서 새 브랜치…", `git branch <이름> ${short(id)}`, async () => {
      const name = await askText("새 브랜치 이름", "feat/new");
      if (name) await run({ op: "createBranch", args: [name, id], summary: `${short(id)} 에서 새 브랜치 ${name}` });
    }));
    items.push(direct("태그 달기…", `git tag <이름> ${short(id)}`, async () => {
      const name = await askText("태그 이름", "v", "예: v1.0.0");
      if (!name) return;
      const message = await askText("태그 설명 (선택)", "", "비워 두면 설명 없는 가벼운 태그, 적으면 주석 태그(-a)를 만듭니다.");
      if (message === null) return;
      await run({ op: "tagCreate", args: [name, id, message || undefined], summary: `태그 ${name} 달기 (${short(id)})` });
    }));
    items.push(direct("이 커밋을 임시로 체크아웃", `git switch --detach ${short(id)}`, () =>
      void run({ op: "checkoutCommit", args: [id], summary: `${short(id)} 임시 체크아웃 (브랜치 없음)` })));
    if (s.head && s.branches[s.head] && isAncestor(s, id, s.branches[s.head]) && s.commits[id].parents.length === 1) {
      items.push(direct("이 커밋 나누기…", "git rebase -i (edit) && git reset HEAD~1", () => {
        if (s.working.staged.length || s.working.unstaged.length) { toast("작업 영역에 변경이 있습니다. 먼저 커밋하거나 stash 한 뒤 나누세요."); return; }
        if (!confirmAction(`"${s.commits[id].msg}" 커밋을 여러 개로 나눕니다.\n커밋의 변경이 작업 영역으로 풀리고, 파일이나 변경 덩어리를 골라 나눠 커밋한 뒤 위 배너의 계속을 누르면 됩니다.`)) return;
        void run({ op: "splitCommit", args: [id], summary: `"${s.commits[id].msg}" 커밋 나누기` });
      }));
    }
  }
  if (src.kind === "label" && src.branch && s.branches[src.branch]) {
    const b = src.branch;
    items.push(direct("이름 바꾸기…", `git branch -m ${b} <새 이름>`, async () => {
      const to = await askText("새 브랜치 이름", b, `${b} 의 이름을 바꿉니다.`);
      if (!to || to === b) return;
      if (s.branches[to]) { toast(`${to} 브랜치가 이미 있습니다.`); return; }
      const up = s.upstream?.[b];
      const withRemote = !!up && confirmAction(`${b} 은(는) 원격 ${up} 와 연결되어 있습니다.\n원격에도 ${to} 로 올리고 옛 이름(${up})을 원격에서 지울까요?\n\n확인 = 원격까지 변경, 취소 = 로컬 이름만 변경`);
      await run({ op: "renameBranch", args: [b, to, withRemote], summary: `${b} → ${to} 이름 변경${withRemote ? " (원격 포함)" : ""}` });
    }));
    const wt = (s.worktrees || []).find((w) => w.branch === b);
    if (!wt) items.push(direct("다른 폴더에 체크아웃 (worktree)…", `git worktree add <폴더> ${b}`, () => void addWorktree(b)));
    else if (!wt.current) items.push(direct(`${b} 쓰는 폴더 열기`, wt.path, () => void open(window.gitApi.open(wt.path))));
    items.push(direct("커밋 정리 (rebase -i)…", `git rebase -i  # ${b}`, () => openRebaseEditor(b)));
    const up = s.upstream?.[b];
    items.push(direct(up ? `upstream 바꾸기 (지금 ${up})…` : "upstream 연결…", `git branch --set-upstream-to=<원격 브랜치> ${b}`, async () => {
      const remoteBranch = await askText("연결할 원격 브랜치", up || `origin/${b}`, "비우면 연결을 끊습니다.");
      if (remoteBranch === null) return;
      await run({ op: "setUpstream", args: [b, remoteBranch], summary: remoteBranch ? `${b} 의 upstream → ${remoteBranch}` : `${b} 의 upstream 연결 끊기` });
    }));
  }
  if (src.kind === "remote" && src.remote) {
    const r = src.remote;
    const local = r.split("/").slice(1).join("/");
    if (!s.branches[local]) {
      items.unshift(direct(`로컬 브랜치 ${local} 로 가져오기`, `git switch --track ${r}`, () =>
        void run({ op: "checkoutRemote", args: [r], summary: `${r} 를 로컬 브랜치로 가져오기` })));
    }
  }
  return items;
}

export function contextItems(src: DragSource): MenuItem[] {
  return [...extraItems(src), ...dragActionItems(src), ...providers.flatMap((p) => p(src))];
}

export function openContextMenu(src: DragSource, x: number, y: number): void {
  if (blocked()) return;
  const s = store.repo;
  if (src.kind === "working" && !s.working.staged.length && !s.working.unstaged.length) { toast("변경이 없습니다."); return; }
  const items = contextItems(src);
  if (!items.length) { toast("이 항목으로 할 수 있는 조작이 없습니다."); return; }
  openMenu(x, y, sourceLabel(src), items, hideInCanvas);
}

export function mountContextMenu(): void {
  document.addEventListener("contextmenu", (e) => {
    const target = e.target as Element;
    // 사이드바 브랜치 목록
    const row = target.closest<HTMLElement>("[data-checkout]");
    if (row) {
      e.preventDefault();
      openContextMenu({ kind: "label", branch: row.dataset.checkout }, e.clientX, e.clientY);
      return;
    }
    const el = target.closest<HTMLElement>("[data-drag]");
    if (!el) return;
    e.preventDefault();
    openContextMenu(withSelection(sourceFromElement(el)), e.clientX, e.clientY);
  });
  // 커밋 노드에 포커스가 있을 때 키보드로 메뉴 열기 (Shift+F10 / 메뉴 키)
  document.addEventListener("keydown", (e) => {
    if (!(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
    // 키보드로 옮겨 간 커밋이 있으면 그것, 아니면 고른 커밋
    const focused = (document.activeElement as Element | null)?.closest?.<SVGGElement>("#graph .node[data-id]")?.dataset.id;
    const id = focused ?? store.ui.selected;
    if (!id) return;
    e.preventDefault();
    const node = document.querySelector(`#graph .node[data-id="${CSS.escape(id)}"]`);
    const r = node?.getBoundingClientRect();
    openContextMenu(withSelection({ kind: "commit", id }), r ? r.right : 200, r ? r.bottom : 200);
  });
}
