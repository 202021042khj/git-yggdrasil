// 하단: stash 트레이 · 휴지통 (둘 다 드래그로 놓는 곳)
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc } from "@/lib/html";

export function renderFooter(): void {
  const s = store.repo;
  byId("stash-list").innerHTML = s.stash.map((st, i) =>
    `<div class="stash-card" data-drag="stash" data-stash="${i}" title="작업 영역으로 끌면 꺼내기 · 휴지통으로 끌면 삭제 · 오른쪽 클릭: 메뉴">
      stash@{${i}} · ${esc(st.msg)}</div>`).join("")
    || `<span class="muted">비어 있음 — 변경 묶음을 여기로 끌면 stash</span>`;
}
