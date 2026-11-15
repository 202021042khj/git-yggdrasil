// ⌘K 찾기: 커밋(메시지·작성자·해시)과 파일 이름
import "./SearchSection.css";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc, short } from "@/lib/html";
import { relTime } from "@/lib/time";
import { revealCommit } from "@/sections/canvas/CanvasSection";
import { toast } from "@/ui/toast";
import type { SearchHit } from "@shared/types/ipc";

type Row = { kind: "commit"; hit: SearchHit } | { kind: "file"; path: string };
let rows: Row[] = [];
let active = 0;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function draw(): void {
  byId("search-list").innerHTML = rows.length
    ? rows.map((r, i) => `<button type="button" role="option" class="sr ${i === active ? "on" : ""}" aria-selected="${i === active}" data-i="${i}">${
        r.kind === "commit"
          ? `<span class="sr-k">커밋</span><span class="sr-t">${esc(r.hit.msg)}</span><span class="sr-m">${short(r.hit.id)} · ${esc(r.hit.author || "")} · ${esc(relTime(r.hit.date))}</span>`
          : `<span class="sr-k">파일</span><span class="sr-t">${esc(r.path)}</span><span class="sr-m">히스토리 보기</span>`}</button>`).join("")
    : `<p class="muted">${(byId<HTMLInputElement>("search-input").value.trim() ? "찾는 결과가 없습니다." : "커밋 메시지, 작성자, 해시, 파일 이름을 입력하세요.")}</p>`;
  byId("search-list").querySelector(".sr.on")?.scrollIntoView({ block: "nearest" });
}

async function query(q: string): Promise<void> {
  const my = ++seq;
  if (!q) { rows = []; active = 0; draw(); return; }
  const lower = q.toLowerCase();
  const files: Row[] = store.repo.files.filter((f) => f.toLowerCase().includes(lower)).slice(0, 8).map((path) => ({ kind: "file", path }));
  let hits: SearchHit[] = [];
  try { hits = await window.gitApi.search(q); } catch { /* 검색 실패는 파일 결과만 */ }
  if (my !== seq) return;
  rows = [...hits.map((hit): Row => ({ kind: "commit", hit })), ...files];
  active = 0;
  draw();
}

function choose(r: Row | undefined): void {
  if (!r) return;
  close();
  if (r.kind === "file") {
    store.update({ selected: null, selectedFile: { path: r.path, commit: null }, detailTab: "history" });
    return;
  }
  if (!revealCommit(r.hit.id)) toast("그래프에 아직 불러오지 않은 오래된 커밋입니다. 아래 '이전 커밋 더 불러오기' 로 더 불러온 뒤 다시 찾으세요.");
}

const close = () => { const d = byId<HTMLDialogElement>("search"); if (d.open) d.close(); };

export function openSearch(): void {
  if (!store.hasRepo()) return;
  const d = byId<HTMLDialogElement>("search");
  const input = byId<HTMLInputElement>("search-input");
  input.value = "";
  rows = [];
  draw();
  if (!d.open) d.showModal();
  input.focus();
}

export function mountSearch(): void {
  const input = byId<HTMLInputElement>("search-input");
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void query(input.value.trim()), 150);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) { active = (active + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length; draw(); }
    } else if (e.key === "Enter") { e.preventDefault(); choose(rows[active]); }
    // 검색 칸의 Esc 는 기본으로 글자만 지우므로, 한 번에 창을 닫는다
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  byId("search-list").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-i]");
    if (b) choose(rows[Number(b.dataset.i)]);
  });
  byId("search").addEventListener("click", (e) => { if (e.target === e.currentTarget) close(); });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
  });
  window.gitApi.onMenuSearch(openSearch);
  byId("search-open").onclick = openSearch;
}
