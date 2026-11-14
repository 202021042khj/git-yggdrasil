// 캔버스: 커밋 그래프 · 레인 이름 고정 · 이전 커밋 더 불러오기
import { loadMore } from "@/app/repoSession";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { dimmedCommits, visibleRepo } from "@/model/filter";
import { renderGraph } from "@/model/layout";

export function renderCanvas(): void {
  const s = store.repo;
  const wrap = byId("canvas-wrap");
  const f = store.ui.filter;
  const r = renderGraph(visibleRepo(s, f), { interactive: true, selected: store.ui.selected, minWidth: wrap.clientWidth, dim: dimmedCommits(s, f), multi: store.ui.multi.length > 1 ? new Set(store.ui.multi) : undefined });
  const svg = byId("graph") as unknown as SVGSVGElement;
  svg.setAttribute("width", String(r.width));
  svg.setAttribute("height", String(Math.max(r.height, wrap.clientHeight - 4)));
  svg.innerHTML = r.svg;
  pinLaneNames();
  const more = byId<HTMLButtonElement>("load-more");
  const shown = Object.keys(s.commits).length;
  more.hidden = !s.truncated;
  more.textContent = `이전 커밋 더 불러오기 (${shown.toLocaleString()} / ${(s.totalCommits || shown).toLocaleString()})`;
}

/** 레인 이름을 가로 스크롤과 상관없이 왼쪽에 붙여 둔다 */
export function pinLaneNames(): void {
  const x = byId("canvas-wrap").scrollLeft;
  for (const id of ["lane-names", "lane-names-preview"]) document.getElementById(id)?.setAttribute("transform", `translate(${x},0)`);
}

/** 커밋이 보이게 스크롤하고 선택 */
export function revealCommit(id: string): boolean {
  store.update({ selected: id, selectedFile: null });
  store.flush();
  const node = document.querySelector(`#graph .node[data-id="${CSS.escape(id)}"]`);
  if (!node) return false;
  const wrap = byId("canvas-wrap");
  const r = node.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  wrap.scrollLeft += r.left - w.left - w.width / 2;
  wrap.scrollTop += r.top - w.top - w.height / 2;
  return true;
}

export function mountCanvas(): void {
  byId("canvas-wrap").addEventListener("scroll", pinLaneNames, { passive: true });
  const more = byId<HTMLButtonElement>("load-more");
  more.onclick = async () => {
    more.disabled = true;
    try { await loadMore(); } finally { more.disabled = false; }
  };
  window.addEventListener("resize", () => store.update({}));
}
