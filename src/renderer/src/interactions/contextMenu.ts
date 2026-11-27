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
import { copyPatch, savePatch } from "@/app/patch";
import { addIgnore, appendCmd, openIgnoreEditor, untrackAndIgnore } from "@/components/pages/main/sections/dialogs/ignoreUtils";
import { dirPattern, extPattern, filePattern } from "@shared/ignore";
import { askText, confirmAction } from "@/components/ui/dialogUtils";
import { openMenu, type MenuItem } from "@/components/ui/menuUtils";
import { toast } from "@/components/ui/toastUtils";
import { t } from "@shared/i18n/i18n";

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

/** 커밋(여러 개면 오래된 것부터) 을 패치로 저장 · 복사 */
const patchItems = (ids: string[]): MenuItem[] => {
  const arg = ids.length === 1 ? `-1 ${short(ids[0])}` : ids.map(short).join(" ");
  return [
    direct(t("ctx.patchSave"), `git format-patch --stdout ${arg} > ${t("ctx.ph.file")}`, () => void savePatch("commits", ids)),
    direct(t("ctx.patchCopy"), `git format-patch --stdout ${arg}`, () => void copyPatch("commits", ids)),
  ];
};

/** 파일 하나: 추적 안 하는 파일은 무시 패턴 추가, 추적 중인 파일은 추적 멈추고 무시 */
function ignoreItems(file: string): MenuItem[] {
  const w = store.repo.working;
  const items: MenuItem[] = [];
  const untracked = (w.untracked || []).includes(file);
  const tracked = !untracked && [...w.staged, ...w.unstaged].includes(file);
  const fp = filePattern(file);
  if (untracked) {
    items.push(direct(t("ctx.ignoreFile"), appendCmd(fp, "gitignore"), () => void addIgnore(fp)));
    const ext = extPattern(file);
    if (ext) items.push(direct(t("ctx.ignoreExt", { ext }), appendCmd(ext, "gitignore"), () => void addIgnore(ext)));
    const dir = dirPattern(file);
    if (dir) items.push(direct(t("ctx.ignoreDir", { dir }), appendCmd(dir, "gitignore"), () => void addIgnore(dir)));
    items.push(direct(t("ctx.ignoreLocal"), appendCmd(fp, "exclude"), () => void addIgnore(fp, "exclude")));
  } else if (tracked) {
    items.push(direct(t("ctx.untrackIgnore"), `git rm --cached -- ${file} && ${appendCmd(fp, "gitignore")}`, () => {
      if (confirmAction(t("ctx.untrackConfirm", { file }))) void untrackAndIgnore(file, fp);
    }));
  }
  items.push(direct(t("ctx.ignoreWhy"), `git check-ignore -v --no-index -- ${file}`, () => openIgnoreEditor(file)));
  return items;
}

/** 드래그와 상관없이 항목 종류별로 붙는 조작 */
function extraItems(src: DragSource): MenuItem[] {
  const s = store.repo;
  const items: MenuItem[] = [];
  if (src.ids && src.ids.length > 1) {
    items.push(direct(t("ctx.clearSelection"), "", () => store.update({ multi: [] })));
    if (src.kind === "commit") items.push(...patchItems(src.ids));
    return items;
  }
  if (src.kind === "commit" && src.id) {
    const id = src.id;
    items.push(direct(t("ctx.newBranch"), `git branch ${t("ctx.ph.name")} ${short(id)}`, async () => {
      const name = await askText(t("ask.newBranchName"), "feat/new");
      if (name) await run({ op: "createBranch", args: [name, id], summary: t("pv.createBranch", { commit: short(id), name }) });
    }));
    items.push(direct(t("ctx.tag"), `git tag ${t("ctx.ph.name")} ${short(id)}`, async () => {
      const name = await askText(t("ctx.tagName"), "v", t("ctx.tagNameHint"));
      if (!name) return;
      const message = await askText(t("ctx.tagMessage"), "", t("ctx.tagMessageHint"));
      if (message === null) return;
      await run({ op: "tagCreate", args: [name, id, message || undefined], summary: t("ctx.tagSummary", { name, commit: short(id) }) });
    }));
    items.push(direct(t("ctx.detach"), `git switch --detach ${short(id)}`, () =>
      void run({ op: "checkoutCommit", args: [id], summary: t("ctx.detachSummary", { commit: short(id) }) })));
    // bisect: 진행 중이 아니면 첫 표시로 시작하고, 진행 중이면 이 커밋에 표시를 더한다 (HEAD 만 옮겨 ⌘Z 기록에는 남지 않는다)
    const bis = s.bisect;
    for (const mark of bis ? (["bad", "good", "skip"] as const) : (["bad", "good"] as const)) {
      const key = mark === "bad" ? "ctx.bisectBad" : mark === "good" ? "ctx.bisectGood" : "ctx.bisectSkip";
      const cmd = `${bis ? "" : "git bisect start && "}git bisect ${mark} ${short(id)}`;
      items.push(direct(t(key), cmd, () => {
        if (s.working.staged.length || s.working.unstaged.length) { toast(t("m.bisectDirty")); return; }
        const p = { mark, commit: short(id) };
        void (bis ? run({ op: "bisectMark", args: [mark, id], summary: t("ctx.bisectMarkSummary", p) })
          : run({ op: "bisectStart", args: [mark, id], summary: t("ctx.bisectStartSummary", p) }));
      }));
    }
    items.push(...patchItems([id]));
    if (s.head && s.branches[s.head] && isAncestor(s, id, s.branches[s.head]) && s.commits[id].parents.length === 1) {
      items.push(direct(t("ctx.split"), "git rebase -i (edit) && git reset HEAD~1", () => {
        if (s.working.staged.length || s.working.unstaged.length) { toast(t("ctx.splitDirty")); return; }
        if (!confirmAction(t("ctx.splitConfirm", { msg: s.commits[id].msg }))) return;
        void run({ op: "splitCommit", args: [id], summary: t("ctx.splitSummary", { msg: s.commits[id].msg }) });
      }));
    }
  }
  if (src.kind === "label" && src.branch && s.branches[src.branch]) {
    const b = src.branch;
    items.push(direct(t("ctx.rename"), `git branch -m ${b} ${t("ctx.ph.newName")}`, async () => {
      const to = await askText(t("ask.newBranchName"), b, t("ctx.renameHint", { branch: b }));
      if (!to || to === b) return;
      if (s.branches[to]) { toast(t("pv.branchExists", { name: to })); return; }
      const up = s.upstream?.[b];
      const withRemote = !!up && confirmAction(t("ctx.renameRemote", { branch: b, upstream: up, to }));
      await run({ op: "renameBranch", args: [b, to, withRemote], summary: withRemote ? t("ctx.renameSummaryRemote", { from: b, to }) : t("ctx.renameSummary", { from: b, to }) });
    }));
    const wt = (s.worktrees || []).find((w) => w.branch === b);
    if (!wt) items.push(direct(t("ctx.worktree"), `git worktree add ${t("ctx.ph.folder")} ${b}`, () => void addWorktree(b)));
    else if (!wt.current) items.push(direct(t("ctx.openWorktree", { branch: b }), wt.path, () => void open(window.gitApi.open(wt.path))));
    items.push(direct(t("ctx.rebasePlan"), `git rebase -i  # ${b}`, () => openRebaseEditor(b)));
    const up = s.upstream?.[b];
    items.push(direct(up ? t("ctx.upstreamChange", { upstream: up }) : t("ctx.upstreamSet"), `git branch --set-upstream-to=${t("ctx.ph.remoteBranch")} ${b}`, async () => {
      const remoteBranch = await askText(t("ctx.upstreamAsk"), up || `origin/${b}`, t("ctx.upstreamHint"));
      if (remoteBranch === null) return;
      await run({ op: "setUpstream", args: [b, remoteBranch], summary: remoteBranch ? t("ctx.upstreamSummary", { branch: b, upstream: remoteBranch }) : t("ctx.upstreamUnset", { branch: b }) });
    }));
  }
  if (src.kind === "working") {
    items.push(direct(t("ctx.patchSaveWorking"), `git diff HEAD --binary > ${t("ctx.ph.file")}`, () => void savePatch("working")));
    if (s.working.staged.length) items.push(direct(t("ctx.patchSaveStaged"), `git diff --cached --binary > ${t("ctx.ph.file")}`, () => void savePatch("staged")));
    items.push(direct(t("ctx.ignoreEdit"), "$EDITOR .gitignore", () => openIgnoreEditor()));
  }
  if (src.kind === "file" && src.file) {
    items.push(...ignoreItems(src.file));
    items.push(direct(t("ctx.ignoreEdit"), "$EDITOR .gitignore", () => openIgnoreEditor()));
  }
  if (src.kind === "remote" && src.remote) {
    const r = src.remote;
    const local = r.split("/").slice(1).join("/");
    if (!s.branches[local]) {
      items.unshift(direct(t("ctx.trackRemote", { branch: local }), `git switch --track ${r}`, () =>
        void run({ op: "checkoutRemote", args: [r], summary: t("ctx.trackSummary", { remote: r }) })));
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
  if (src.kind === "working" && !s.working.staged.length && !s.working.unstaged.length) { toast(t("ctx.noChanges")); return; }
  const items = contextItems(src);
  if (!items.length) { toast(t("ctx.nothing")); return; }
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
