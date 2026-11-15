// 작업 영역: 커밋 메시지 칸 · 변경 묶음 손잡이 · 폴더 트리 (체크 = stage, ↶ = 버리기)
import "./WorkingSection.css";
import { blocked, run, runPreviewed } from "@/app/actions";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc } from "@/lib/html";
import { isError, preview } from "@/model/preview";
import { toast } from "@/ui/toast";

interface TreeNode {
  name: string;
  path: string;
  kids: Map<string, TreeNode>;
  file: boolean;
}

function buildTree(rootName: string, paths: string[]): TreeNode {
  const root: TreeNode = { name: rootName, path: "", kids: new Map(), file: false };
  for (const p of paths) {
    let node = root;
    p.split("/").forEach((part, i, arr) => {
      const path = arr.slice(0, i + 1).join("/");
      if (!node.kids.has(part)) node.kids.set(part, { name: part, path, kids: new Map(), file: i === arr.length - 1 });
      node = node.kids.get(part)!;
    });
  }
  return root;
}
const leafFiles = (n: TreeNode): string[] => (n.file ? [n.path] : [...n.kids.values()].flatMap(leafFiles));
const icon = (name: string) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function renderWorking(): void {
  const s = store.repo, ui = store.ui;
  const w = s.working;
  const staged = new Set(w.staged), unstaged = new Set(w.unstaged);
  const changed = new Set([...w.staged, ...w.unstaged]);
  const conflicted = new Set(w.conflicted);
  const resolved = s.op?.resolved ?? {};
  const lfsSet = new Set(s.lfs?.files ?? []);
  const subSet = new Set((s.submodules ?? []).map((m) => m.path));
  const committed = new Set(s.files);
  const root = buildTree(s.repoName || "", [...new Set([...s.files, ...changed, ...conflicted])].sort());
  const rows: string[] = [];
  const walk = (n: TreeNode, depth: number) => {
    const files = leafFiles(n);
    const ch = files.filter((f) => changed.has(f));
    const fullyStaged = ch.filter((f) => staged.has(f) && !unstaged.has(f));
    const partly = ch.filter((f) => staged.has(f) && unstaged.has(f));
    const cf = files.filter((f) => conflicted.has(f));
    if (ui.onlyChanged && !ch.length && !cf.length && n.path !== "") return;
    const open = !ui.collapsed.has(n.path);
    const chk = !ch.length ? "disabled" : fullyStaged.length === ch.length ? "checked" : fullyStaged.length || partly.length ? "data-ind" : "";
    const isCf = n.file && conflicted.has(n.path);
    const stagedCount = fullyStaged.length + partly.length;
    const badge = isCf
      ? `<span class="st ${resolved[n.path] ? "S" : "C"}">${resolved[n.path] ? "✓" : "C"}</span>`
      : n.file
        ? ch.length ? `<span class="st ${committed.has(n.path) ? "M" : "U"}" title="${partly.length ? "일부만 stage 됨" : ""}">${partly.length ? "◐" : committed.has(n.path) ? "M" : "U"}</span>` : ""
        : ch.length || cf.length ? `<span class="st">${cf.length ? `<span class="st C">⚠${cf.length}</span> ` : ""}${ch.length ? `${stagedCount ? `${stagedCount}/` : ""}${ch.length}` : ""}</span>` : "";
    const active = ui.selectedFile && !ui.selectedFile.commit && ui.selectedFile.path === n.path ? "active" : "";
    const cfCls = isCf ? (resolved[n.path] ? "conflict resolved" : "conflict") : "";
    rows.push(`<div class="ft-row ${n.file ? "file" : "folder"} ${ch.length || cf.length ? "" : "clean"} ${cfCls} ${active}" ${ch.length ? `data-drag="file" data-file="${esc(n.path)}"` : ""}
      data-path="${esc(n.path)}" data-isfile="${n.file ? 1 : ""}" style="padding-left:${depth * 12 + 4}px" title="${esc(n.path || "저장소 루트")}">
      <span class="chev" ${n.file ? "" : `data-toggle="${esc(n.path)}"`}>${n.file ? "" : open ? "▾" : "▸"}</span>
      <input type="checkbox" data-stage="${esc(n.path)}" ${chk} aria-label="${esc(n.path || "전체")} stage" />
      <span class="name">${icon(n.path === "" ? "box" : n.file ? "file" : "folder")}${esc(n.name)}${n.file && lfsSet.has(n.path) ? ' <span class="tag-mini" title="Git LFS 로 관리하는 파일">LFS</span>' : ""}${n.file && subSet.has(n.path) ? ' <span class="tag-mini" title="서브모듈 (다른 저장소)">서브모듈</span>' : ""}</span>${badge}
      ${ch.length ? `<button type="button" class="discard" data-discard="${esc(n.path)}" title="변경 버리기 (git restore)" aria-label="${esc(n.path || "전체")} 변경 버리기">↶</button>` : ""}</div>`);
    if (!n.file && open) [...n.kids.values()].sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name)).forEach((k) => walk(k, depth + 1));
  };
  walk(root, 0);
  const tree = byId("file-tree");
  tree.innerHTML = rows.join("");
  tree.querySelectorAll<HTMLInputElement>("input[data-ind]").forEach((i) => (i.indeterminate = true));
  byId("work-summary").textContent = `변경 ${changed.size} · staged ${staged.size}`;
  const h = document.querySelector<HTMLElement>(".working-handle")!;
  h.classList.toggle("empty", !changed.size);
  h.textContent = w.staged.length ? `Staged ${w.staged.length}개 끌기` : w.unstaged.length ? `변경 ${w.unstaged.length}개 모두 끌기` : "변경 없음";
  const btn = byId<HTMLButtonElement>("commit-btn");
  const target = s.head || (s.detached ? "HEAD" : "");
  btn.disabled = !changed.size || !target;
  btn.textContent = !changed.size ? "커밋할 변경 없음"
    : `${s.head || "브랜치 없이(HEAD)"} 에 커밋 (${w.staged.length ? `staged ${w.staged.length}개` : `변경 전체 ${changed.size}개`})`;
}

/** 메시지 칸으로 현재 브랜치에 커밋 */
async function commitFromBox(): Promise<void> {
  const s = store.repo;
  if (blocked("commitTo")) return;
  const box = byId<HTMLTextAreaElement>("commit-msg");
  const msg = box.value.trim();
  if (!msg) { box.focus(); toast("커밋 메시지를 입력하세요."); return; }
  const branch = s.head || "HEAD";
  const res = preview("commitTo", s, [branch, msg, undefined]);
  if (isError(res)) { toast(res.error); return; }
  box.value = "";
  await run({ op: "commitTo", args: [branch, msg, undefined], summary: res.summary });
}

export function mountWorking(): void {
  byId("commit-btn").onclick = () => void commitFromBox();
  byId("commit-msg").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commitFromBox();
    }
  });
  byId<HTMLInputElement>("only-changed").onchange = (e) => store.update({ onlyChanged: (e.target as HTMLInputElement).checked });

  const tree = byId("file-tree");
  // 체크박스 = stage/unstage (폴더면 하위 전체)
  tree.addEventListener("change", (e) => {
    const cb = (e.target as Element).closest<HTMLInputElement>("input[data-stage]");
    if (!cb) return;
    const path = cb.dataset.stage!;
    const to = cb.checked ? "staged" : "unstaged";
    void run({ op: "stageFiles", args: [[path], to], summary: `${path || "전체"} ${to === "staged" ? "stage" : "unstage"}` });
  });
  tree.addEventListener("click", (e) => {
    const t = e.target as Element;
    const dis = t.closest<HTMLElement>("[data-discard]");
    if (dis) {
      const res = preview("discard", store.repo, [[dis.dataset.discard!]]);
      if (isError(res)) toast(res.error);
      else void runPreviewed("discard", [[dis.dataset.discard!]], res);
      return;
    }
    const toggle = t.closest<HTMLElement>("[data-toggle]");
    if (toggle) {
      const collapsed = new Set(store.ui.collapsed);
      const p = toggle.dataset.toggle!;
      if (collapsed.has(p)) collapsed.delete(p);
      else collapsed.add(p);
      store.update({ collapsed });
      return;
    }
    if (t.closest("input")) return;
    const row = t.closest<HTMLElement>(".ft-row[data-isfile='1']");
    if (row) store.update({ selected: null, selectedFile: { path: row.dataset.path!, commit: null }, detailTab: "diff" });
  });
}
