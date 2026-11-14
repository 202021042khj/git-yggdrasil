// 상세 패널: 커밋 정보 · 메시지 수정 · 파일 diff · 파일 히스토리 · blame · 변경 덩어리 stage · 충돌 해결
import { blocked, run } from "@/app/actions";
import { store, type DetailTab } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc, short } from "@/lib/html";
import { fullTime, relTime } from "@/lib/time";
import { ownerBranch, pushedSet, stems } from "@/model/graph";
import { oldestFirst } from "@/model/selection";
import { confirmAction } from "@/ui/dialog";
import { toast } from "@/ui/toast";
import { handleConflictEditorClick, loadConflictEditor, mountConflictEditor } from "@/sections/ConflictEditor";
import { DIFF_PREFS_KEY } from "@/constants/storage";
import { splitRows, type SideCell } from "@/model/diffView";
import type { FileDiff, Hunk } from "@shared/types/ipc";

const diffLineClass = (l: string) => (/^(\+\+\+|---|diff |index )/.test(l) ? "ctx" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "ctx");
const diffLines = (text: string) => text.split("\n").map((l) => `<span class="${diffLineClass(l)}">${esc(l)}</span>`).join("");

/** 비동기로 채우는 영역: 채우기 전에 패널을 다시 그렸으면 버린다 (renderDetail 마다 세대가 바뀐다) */
let renderSeq = 0;
function fillLater(slot: string, load: () => Promise<string>): string {
  const seq = renderSeq;
  queueMicrotask(async () => {
    let html: string;
    try { html = await load(); } catch (err) { html = `<p class="muted">${esc((err as Error).message)}</p>`; }
    if (seq !== renderSeq) return;
    const el = document.querySelector(`[data-slot="${slot}"]`);
    if (el) el.innerHTML = html;
  });
  return `<div data-slot="${slot}"><p class="muted">불러오는 중…</p></div>`;
}

// ---------- diff 보기: 통합 / 좌우, 공백 무시, 전체 보기, 이미지 ----------
interface DiffPrefs { split: boolean; ignoreWhitespace: boolean }
const diffPrefs: DiffPrefs = (() => {
  try { return { split: false, ignoreWhitespace: false, ...JSON.parse(localStorage.getItem(DIFF_PREFS_KEY) || "{}") }; } catch { return { split: false, ignoreWhitespace: false }; }
})();
/** "전체 보기" 를 누른 diff (파일+커밋) */
let fullKey = "";

function splitTable(text: string): string {
  const cell = (c: SideCell | null) => c
    ? `<td class="no">${c.no}</td><td class="${c.kind}">${esc(c.text) || " "}</td>`
    : `<td class="no"></td><td class="empty"></td>`;
  return `<table class="split"><colgroup><col class="nc"><col><col class="nc"><col></colgroup>${splitRows(text).map((r) => r.kind === "hunk"
    ? `<tr class="sh"><td colspan="4">${esc(r.header)}</td></tr>`
    : `<tr>${cell(r.left)}${cell(r.right)}</tr>`).join("")}</table>`;
}

function diffBody(d: FileDiff, key: string): string {
  const img = d.image
    ? `<div class="img-diff">${d.image.before ? `<figure><figcaption>전</figcaption><img src="${d.image.before}" alt="바뀌기 전 이미지"></figure>` : ""}
       ${d.image.after ? `<figure><figcaption>${d.image.before ? "후" : "새 파일"}</figcaption><img src="${d.image.after}" alt="바뀐 뒤 이미지"></figure>` : `<p class="muted">이 파일은 지워졌습니다.</p>`}</div>`
    : "";
  if (d.binary) return img || `<p class="muted">바이너리 파일이라 내용을 비교해 보여 줄 수 없습니다.</p>`;
  const body = !d.text ? `<p class="muted">${diffPrefs.ignoreWhitespace ? "공백 말고는 바뀐 내용이 없습니다." : "변경 내용 없음"}</p>`
    : diffPrefs.split ? splitTable(d.text) : `<pre>${diffLines(d.text)}</pre>`;
  const lfsNote = /git-lfs\.github\.com\/spec/.test(d.text)
    ? `<p class="muted ex-note">Git LFS 포인터 파일입니다. 실제 내용은 LFS 서버에 있고, 여기에는 크기와 해시만 바뀐 것으로 보입니다.</p>` : "";
  const more = d.omitted ? `<button type="button" class="small more-diff" data-diff-full="${esc(key)}">${d.omitted.toLocaleString()}줄 더 보기 (전체)</button>` : "";
  return img + lfsNote + body + more;
}

function diffBox(title: string, file: string, commit: string | null): string {
  const key = `${commit ?? "work"}:${file}`;
  const tools = `<span class="diff-tools">
      <span class="seg" role="group" aria-label="diff 보기 방식">
        <button type="button" class="small" data-diff-view="unified" aria-pressed="${!diffPrefs.split}">통합</button>
        <button type="button" class="small" data-diff-view="split" aria-pressed="${diffPrefs.split}">좌우</button></span>
      <label class="muted"><input type="checkbox" data-diff-ws ${diffPrefs.ignoreWhitespace ? "checked" : ""}> 공백 무시</label></span>`;
  return `<div class="diff"><div class="dh"><span class="dt">${esc(title)}</span>${tools}</div>${fillLater("diff", async () =>
    diffBody(await window.gitApi.diff(file, commit, { ignoreWhitespace: diffPrefs.ignoreWhitespace, full: fullKey === key }), key))}</div>`;
}

function setDiffPrefs(patch: Partial<DiffPrefs>): void {
  Object.assign(diffPrefs, patch);
  try { localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify(diffPrefs)); } catch { /* 이번 실행에서만 */ }
  store.update({});
}

function hunkList(file: string): string {
  return fillLater("hunks", async () => {
    const [unstaged, staged] = await Promise.all([window.gitApi.hunks(file, false), window.gitApi.hunks(file, true)]);
    if (!unstaged.length && !staged.length) return "";
    const block = (h: Hunk, isStaged: boolean) => `<div class="hunk" data-hunk-box="${h.index}" data-staged="${isStaged ? 1 : ""}">
      <div class="hunk-head"><code>${esc(h.header)}</code>
        <button type="button" class="small" data-hunk-lines hidden>${isStaged ? "고른 줄만 unstage" : "고른 줄만 stage"}</button>
        <button type="button" class="small" data-hunk="${h.index}" data-staged="${isStaged ? 1 : ""}">${isStaged ? "이 덩어리 unstage" : "이 덩어리만 stage"}</button></div>
      <pre>${h.lines.map((l, i) => /^[+-]/.test(l)
        ? `<span class="${diffLineClass(l)} pick" role="checkbox" aria-checked="false" tabindex="0" data-ln="${i}" title="클릭해서 이 줄 고르기">${esc(l)}</span>`
        : `<span class="${diffLineClass(l)}">${esc(l)}</span>`).join("")}</pre></div>`;
    return `${unstaged.length ? `<h4>아직 stage 안 한 변경 (${unstaged.length}덩어리)</h4>${unstaged.map((h) => block(h, false)).join("")}` : ""}
      <p class="muted hint">+/- 줄을 클릭(또는 Space)해서 고르면 그 줄만 stage 할 수 있습니다.</p>
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
      <div class="cf-actions">${btn(f, "ours", "A 쪽 사용")}${btn(f, "theirs", "B 쪽 사용")}${btn(f, "both", "외부 에디터로")}</div></div>`).join("")}
    ${focus && !o.resolved[focus] ? `<h4>${esc(focus)} — 구간별로 고르기</h4>${fillLater("conflict-editor", () => loadConflictEditor(focus))}` : ""}</div>`;
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

/** 여러 커밋을 골랐을 때: 목록과 할 수 있는 일 안내 */
function multiView(ids: string[]): string {
  const s = store.repo;
  const sorted = oldestFirst(s, ids);
  return `<div class="multi-view"><h4>커밋 ${sorted.length}개 선택됨</h4>
    <ol class="hist">${sorted.map((id) => `<li><button type="button" class="link" data-goto="${id}">${esc(s.commits[id].msg)}</button><span class="muted">${short(id)}${s.commits[id].author ? ` · ${esc(s.commits[id].author!)}` : ""}</span></li>`).join("")}</ol>
    <p class="muted hint">고른 커밋 중 하나를 다른 브랜치 이름표에 끌어 놓거나 오른쪽 클릭하면, 오래된 것부터 한꺼번에 복사(cherry-pick)합니다. ⌘ 클릭으로 더하거나 빼고, Shift 클릭은 같은 브랜치에서 범위를 고릅니다. Esc 로 선택을 풉니다.</p>
    <button type="button" class="small" data-multi-clear>선택 풀기</button></div>`;
}

export function renderDetail(): void {
  const s = store.repo, ui = store.ui;
  const body = byId("detail-body");
  renderSeq++;
  if (ui.multi.length > 1) { body.innerHTML = conflictPanel() + multiView(ui.multi); return; }
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

/** 변경 줄 고르기 (다시 그리지 않고 그 자리에서 표시만 바꾼다) */
function toggleLine(el: HTMLElement): void {
  el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true"));
  const box = el.closest<HTMLElement>("[data-hunk-box]")!;
  const n = box.querySelectorAll("[data-ln][aria-checked=true]").length;
  const btn = box.querySelector<HTMLButtonElement>("[data-hunk-lines]")!;
  btn.hidden = !n;
  btn.textContent = `고른 ${n}줄만 ${box.dataset.staged ? "unstage" : "stage"}`;
}

export function mountDetail(onGoto: (id: string) => void): void {
  byId("detail-body").addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-diff-ws]")) setDiffPrefs({ ignoreWhitespace: t.checked });
  });
  byId("detail-body").addEventListener("keydown", (e) => {
    const ln = (e.target as Element).closest?.<HTMLElement>("[data-ln]");
    if (ln && (e.key === " " || e.key === "Enter")) { e.preventDefault(); toggleLine(ln); }
  });
  mountConflictEditor(byId("detail-body"));
  byId("detail-body").addEventListener("click", (e) => {
    const t = e.target as Element;
    if (handleConflictEditorClick(t)) return;
    if (t.closest("[data-multi-clear]")) return store.update({ multi: [] });
    const view = t.closest<HTMLElement>("[data-diff-view]");
    if (view) return setDiffPrefs({ split: view.dataset.diffView === "split" });
    const more = t.closest<HTMLElement>("[data-diff-full]");
    if (more) { fullKey = more.dataset.diffFull!; return store.update({}); }
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab) return store.update({ detailTab: tab.dataset.tab as DetailTab });
    const inCommit = t.closest<HTMLElement>("[data-file-in-commit]");
    if (inCommit) return store.update({ selectedFile: { path: inCommit.dataset.fileInCommit!, commit: store.ui.selected }, detailTab: "diff" });
    const go = t.closest<HTMLElement>("[data-goto]");
    if (go) return onGoto(go.dataset.goto!);
    const file = store.ui.selectedFile?.path;
    const ln = t.closest<HTMLElement>("[data-ln]");
    if (ln) return toggleLine(ln);
    if (t.closest("[data-hunk-lines]") && file) {
      const box = t.closest<HTMLElement>("[data-hunk-box]")!;
      const picked = [...box.querySelectorAll<HTMLElement>("[data-ln][aria-checked=true]")].map((el) => Number(el.dataset.ln));
      const staged = !!box.dataset.staged;
      void run({ op: "stageHunk", args: [file, Number(box.dataset.hunkBox), staged, picked], summary: `${file} 의 고른 ${picked.length}줄 ${staged ? "unstage" : "stage"}` });
      return;
    }
    const hunk = t.closest<HTMLElement>("[data-hunk]");
    if (hunk && file) {
      const staged = !!hunk.dataset.staged;
      void run({ op: "stageHunk", args: [file, Number(hunk.dataset.hunk), staged], summary: `${file} 의 변경 덩어리 ${staged ? "unstage" : "stage"}` });
      return;
    }
    const resolve = t.closest<HTMLElement>("[data-resolve]");
    if (resolve) {
      const f = resolve.dataset.resolve!;
      store.update({ selectedFile: { path: f, commit: null } });
      const how = { ours: "A 쪽", theirs: "B 쪽", both: "외부 에디터" }[resolve.dataset.choice as "ours" | "theirs" | "both"];
      void run({ op: "resolveFile", args: [f, resolve.dataset.choice], summary: `${f}: ${how}` });
      return;
    }
    const cf = t.closest<HTMLElement>("[data-cf]");
    if (cf) store.update({ selectedFile: { path: cf.dataset.cf!, commit: null } });
  });
}
