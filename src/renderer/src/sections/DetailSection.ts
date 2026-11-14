// 상세 패널: 커밋 정보 · 메시지 수정 · 파일 diff · 파일 히스토리 · blame · 변경 덩어리 stage · 충돌 해결
import { blocked, run } from "@/app/actions";
import { store, type DetailTab } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc, short } from "@/lib/html";
import { fullTime, relTime } from "@/lib/time";
import { ownerBranch, pushedSet, stems } from "@/model/graph";
import { confirmAction } from "@/ui/dialog";
import { toast } from "@/ui/toast";
import type { Hunk } from "@shared/types/ipc";

const diffLineClass = (l: string) => (/^(\+\+\+|---|diff |index )/.test(l) ? "ctx" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx");
const diffLines = (text: string) => (text || "(변경 내용 없음)").split("\n").map((l) => `<span class="${diffLineClass(l)}">${esc(l)}</span>`).join("");

/** 비동기로 채우는 영역: 그리는 사이 다른 것을 골랐으면 버린다 */
let renderSeq = 0;
function fillLater(slot: string, load: () => Promise<string>): string {
  const seq = ++renderSeq;
  queueMicrotask(async () => {
    let html: string;
    try { html = await load(); } catch (err) { html = `<p class="muted">${esc((err as Error).message)}</p>`; }
    if (seq !== renderSeq) return;
    const el = document.querySelector(`[data-slot="${slot}"]`);
    if (el) el.innerHTML = html;
  });
  return `<div data-slot="${slot}"><p class="muted">불러오는 중…</p></div>`;
}

function diffBox(title: string, file: string, commit: string | null): string {
  return `<div class="diff"><div class="dh">${esc(title)}</div>${fillLater("diff", async () => `<pre>${diffLines(await window.gitApi.diff(file, commit))}</pre>`)}</div>`;
}

function hunkList(file: string): string {
  return fillLater("hunks", async () => {
    const [unstaged, staged] = await Promise.all([window.gitApi.hunks(file, false), window.gitApi.hunks(file, true)]);
    if (!unstaged.length && !staged.length) return "";
    const block = (h: Hunk, isStaged: boolean) => `<div class="hunk">
      <div class="hunk-head"><code>${esc(h.header)}</code>
        <button type="button" class="small" data-hunk="${h.index}" data-staged="${isStaged ? 1 : ""}">${isStaged ? "이 덩어리 unstage" : "이 덩어리만 stage"}</button></div>
      <pre>${diffLines(h.lines.join("\n"))}</pre></div>`;
    return `${unstaged.length ? `<h4>아직 stage 안 한 변경 (${unstaged.length}덩어리)</h4>${unstaged.map((h) => block(h, false)).join("")}` : ""}
      ${staged.length ? `<h4>stage 한 변경 (${staged.length}덩어리)</h4>${staged.map((h) => block(h, true)).join("")}` : ""}`;
  });
}

function historyList(file: string): string {
  return fillLater("history", async () => {
    const list = await window.gitApi.fileHistory(file);
    if (!list.length) return `<p class="muted">이 파일을 바꾼 커밋이 없습니다.</p>`;
    return `<ol class="hist">${list.map((h) => `<li><button type="button" class="link" data-goto="${h.id}">${esc(h.msg)}</button>
      <span class="muted">${short(h.id)} · ${esc(h.author || "")} · ${esc(relTime(h.date))}${h.path !== file ? ` · 당시 이름 ${esc(h.path)}` : ""}</span></li>`).join("")}</ol>`;
  });
}

function blameView(file: string, commit: string | null): string {
  return fillLater("blame", async () => {
    const lines = await window.gitApi.blame(file, commit);
    let prev = "";
    return `<div class="blame">${lines.map((l) => {
      const first = l.commit !== prev;
      prev = l.commit;
      return `<div class="bl ${first ? "first" : ""}"><span class="bl-meta">${first ? `<button type="button" class="link" data-goto="${l.commit}" title="${esc(l.summary)}">${short(l.commit)}</button> ${esc(l.author)} · ${esc(relTime(l.date))}` : ""}</span><span class="bl-no">${l.line}</span><code class="bl-text">${esc(l.text)}</code></div>`;
    }).join("")}</div>`;
  });
}

function fileView(path: string, commit: string | null): string {
  const tab = store.ui.detailTab;
  const tabs: Array<[DetailTab, string]> = [["diff", "변경"], ["history", "히스토리"], ["blame", "blame"]];
  const isWorking = !commit;
  const s = store.repo;
  const changed = isWorking && (s.working.staged.includes(path) || s.working.unstaged.includes(path));
  const body = tab === "history" ? historyList(path)
    : tab === "blame" ? blameView(path, commit)
    : isWorking
      ? changed ? `${diffBox(path, path, null)}${hunkList(path)}` : `<p class="muted">작업 영역에서 바뀌지 않은 파일입니다. 히스토리나 blame 을 보세요.</p>`
      : diffBox(path, path, commit);
  return `<div class="file-view">
    <div class="kv"><b>${esc(path)}</b> ${isWorking ? `<span class="muted">· 작업 영역${changed ? (s.working.staged.includes(path) ? (s.working.unstaged.includes(path) ? " · 일부 stage" : " · Staged") : " · Unstaged") : ""}</span>` : `<span class="muted">· ${short(commit!)} 에서</span>`}</div>
    <div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button type="button" role="tab" aria-selected="${k === tab}" data-tab="${k}">${label}</button>`).join("")}</div>
    ${body}</div>`;
}

function conflictPanel(): string {
  const o = store.repo.op;
  if (!o || o.kind === "split" || !o.conflicts.length) return "";
  const sel = store.ui.selectedFile;
  const focus = sel && o.conflicts.includes(sel.path) ? sel.path : o.conflicts.find((f) => !o.resolved[f]) || o.conflicts[0];
  const btn = (f: string, choice: string, text: string) => `<button type="button" data-resolve="${esc(f)}" data-choice="${choice}" class="${o.resolved[f] === choice ? "on" : ""}">${text}</button>`;
  const rebaseNote = o.kind === "rebase"
    ? `<div class="cf-side">※ rebase 중에는 git 의 <code>--ours</code> 가 <b>대상(받는 쪽)</b>, <code>--theirs</code> 가 <b>내 커밋</b>입니다. 버튼은 의미대로 표시했습니다.</div>` : "";
  return `<div class="conflict-box"><h4>⚠ 충돌 해결 — 파일마다 어느 쪽을 쓸지 고르세요</h4>
    <div class="cf-side">A = ${esc(o.oursName)}<br>B = ${esc(o.theirsName)}</div>${rebaseNote}
    ${o.conflicts.map((f) => `<div class="cf-file">
      <button type="button" class="cf-name link ${o.resolved[f] ? "done" : ""}" data-cf="${esc(f)}">${o.resolved[f] ? "✓" : "⚠"} ${esc(f)}</button>
      <div class="cf-actions">${btn(f, "ours", "A 쪽 사용")}${btn(f, "theirs", "B 쪽 사용")}${btn(f, "both", "직접 편집 (에디터)")}</div></div>`).join("")}
    ${focus ? diffBox(`${focus} — 실제 충돌 내용`, focus, null) : ""}</div>`;
}

function commitView(id: string): string {
  const s = store.repo;
  const c = s.commits[id];
  const p = pushedSet(s).has(id);
  const st = stems(s);
  const lane = st.owner.get(id) || "(브랜치 없음)";
  const editable = !!ownerBranch(s, id, st);
  const tags = Object.values(s.tags || {}).filter((t) => t.target === id);
  const sel = store.ui.selectedFile;
  return `
    <div class="reword">
      <input id="msg-input" value="${esc(c.msg)}" ${editable ? "" : "disabled"} aria-label="커밋 메시지" />
      <button type="button" id="msg-save" class="small" title="Enter" ${editable ? "" : "disabled"}>메시지 수정</button>
    </div>
    ${p ? `<div class="kv lock-note">push 된 커밋 — 수정하면 force push 가 필요합니다</div>` : ""}
    <div class="kv"><code>${c.id}</code></div>
    ${c.author ? `<div class="kv">작성자: ${esc(c.author)}</div>` : ""}
    ${c.date ? `<div class="kv" title="${esc(fullTime(c.date))}">날짜: ${esc(relTime(c.date))} · ${esc(fullTime(c.date))}</div>` : ""}
    <div class="kv">줄기: ${esc(lane)}</div>
    ${tags.length ? `<div class="kv">태그: ${tags.map((t) => `<code>${esc(t.name)}</code>${t.message ? ` ${esc(t.message)}` : ""}`).join(", ")}</div>` : ""}
    <div class="kv">부모: ${c.parents.map((x) => `<button type="button" class="link" data-goto="${x}"><code>${short(x)}</code></button>`).join(", ") || "없음 (첫 커밋)"}</div>
    <div class="kv">파일 (클릭하면 diff):<br>${c.files.map((f) => `<button type="button" class="file-link link" data-file-in-commit="${esc(f)}">${esc(f)}</button>`).join("<br>") || "- (merge 커밋)"}</div>
    ${sel && sel.commit === id ? fileView(sel.path, id) : ""}`;
}

export function renderDetail(): void {
  const s = store.repo, ui = store.ui;
  const body = byId("detail-body");
  const c = ui.selected ? s.commits[ui.selected] : null;
  const main = c ? commitView(c.id)
    : ui.selectedFile && !ui.selectedFile.commit ? fileView(ui.selectedFile.path, null)
    : s.op ? "" : `<span class="muted">커밋이나 파일을 클릭하면 상세 정보와 diff 가 보입니다. ⌘K 로 커밋·파일을 찾을 수 있습니다.</span>`;
  body.innerHTML = conflictPanel() + main;
  if (c) {
    const input = byId<HTMLInputElement>("msg-input");
    const save = () => void reword(c.id, input.value);
    byId("msg-save").onclick = save;
    input.onkeydown = (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") { input.value = c.msg; input.blur(); }
    };
  }
}

async function reword(id: string, msg: string): Promise<void> {
  const s = store.repo;
  if (blocked()) return;
  msg = msg.trim();
  if (!msg || msg === s.commits[id].msg) { toast(msg ? "메시지가 같습니다." : "메시지가 비어 있습니다."); return; }
  if (pushedSet(s).has(id) && !confirmAction("push 된 커밋의 메시지를 바꿉니다.\n원격과 히스토리가 달라져서 이후 force push 가 필요합니다. 계속할까요?")) return;
  await run({ op: "reword", args: [id, msg], summary: `${short(id)} "${s.commits[id].msg}" 메시지 → "${msg}"` });
}

/** 커밋 더블클릭: 선택하고 메시지 입력칸에 커서 */
export function focusMessageInput(id: string): void {
  store.update({ selected: id, selectedFile: null });
  store.flush();
  const input = document.getElementById("msg-input") as HTMLInputElement | null;
  if (input && !input.disabled) { input.focus(); input.select(); }
}

export function mountDetail(onGoto: (id: string) => void): void {
  byId("detail-body").addEventListener("click", (e) => {
    const t = e.target as Element;
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab) return store.update({ detailTab: tab.dataset.tab as DetailTab });
    const inCommit = t.closest<HTMLElement>("[data-file-in-commit]");
    if (inCommit) return store.update({ selectedFile: { path: inCommit.dataset.fileInCommit!, commit: store.ui.selected }, detailTab: "diff" });
    const go = t.closest<HTMLElement>("[data-goto]");
    if (go) return onGoto(go.dataset.goto!);
    const hunk = t.closest<HTMLElement>("[data-hunk]");
    const file = store.ui.selectedFile?.path;
    if (hunk && file) {
      const staged = !!hunk.dataset.staged;
      void run({ op: "stageHunk", args: [file, Number(hunk.dataset.hunk), staged], summary: `${file} 의 변경 덩어리 ${staged ? "unstage" : "stage"}` });
      return;
    }
    const resolve = t.closest<HTMLElement>("[data-resolve]");
    if (resolve) {
      const f = resolve.dataset.resolve!;
      store.update({ selectedFile: { path: f, commit: null } });
      const how = { ours: "A 쪽", theirs: "B 쪽", both: "직접 편집" }[resolve.dataset.choice as "ours" | "theirs" | "both"];
      void run({ op: "resolveFile", args: [f, resolve.dataset.choice], summary: `${f}: ${how}` });
      return;
    }
    const cf = t.closest<HTMLElement>("[data-cf]");
    if (cf) store.update({ selectedFile: { path: cf.dataset.cf!, commit: null } });
  });
}
