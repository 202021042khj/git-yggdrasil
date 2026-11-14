// 캔버스: 커밋 그래프 · 레인 이름 고정 · 이전 커밋 더 불러오기
import { loadMore } from "@/app/repoSession";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { dimmedCommits, visibleRepo } from "@/model/filter";
import { renderGraph } from "@/model/layout";

/** 화살표로 옮겨 간 커밋 (다시 그려도 초점을 그 자리에 둔다). 클릭·Enter 로 고르면 고른 커밋을 따른다 */
let keyboardFocus: string | null = null;

export function renderCanvas(): void {
  const s = store.repo;
  const wrap = byId("canvas-wrap");
  const f = store.ui.filter;
  const hadFocus = !!document.activeElement?.closest("#graph");
  const r = renderGraph(visibleRepo(s, f), { interactive: true, selected: store.ui.selected, minWidth: wrap.clientWidth, dim: dimmedCommits(s, f), focusId: keyboardFocus && s.commits[keyboardFocus] ? keyboardFocus : null, multi: store.ui.multi.length > 1 ? new Set(store.ui.multi) : undefined });
  const svg = byId("graph") as unknown as SVGSVGElement;
  svg.setAttribute("width", String(r.width));
  svg.setAttribute("height", String(Math.max(r.height, wrap.clientHeight - 4)));
  svg.innerHTML = r.svg;
  // 키보드로 고르면 다시 그려지므로 초점을 같은 커밋에 되돌린다
  if (hadFocus) svg.querySelector<SVGGElement>('.node[tabindex="0"]')?.focus({ preventScroll: true });
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
export function revealCommit(id: string, select = true): boolean {
  if (select) { store.update({ selected: id, selectedFile: null }); store.flush(); }
  const node = document.querySelector(`#graph .node[data-id="${CSS.escape(id)}"]`);
  if (!node) return false;
  const wrap = byId("canvas-wrap");
  const r = node.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  wrap.scrollLeft += r.left - w.left - w.width / 2;
  wrap.scrollTop += r.top - w.top - w.height / 2;
  return true;
}

/** 화살표 이동: ←→ 같은 줄 앞뒤, ↑↓ 위아래 줄의 가장 가까운 커밋, Home·End 줄의 처음과 끝 */
function nextNode(from: SVGGElement, key: string): SVGGElement | null {
  const at = (el: Element) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.getAttribute("transform") || "");
    return { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) };
  };
  const me = at(from);
  const all = [...byId("graph").querySelectorAll<SVGGElement>(".node[data-id]")].map((el) => ({ el, ...at(el) })).filter((n) => n.el !== from);
  const sameRow = all.filter((n) => n.y === me.y);
  const pick = (list: typeof all, score: (n: (typeof all)[0]) => number) => list.sort((a, b) => score(a) - score(b))[0]?.el ?? null;
  switch (key) {
    case "ArrowRight": return pick(sameRow.filter((n) => n.x > me.x), (n) => n.x - me.x);
    case "ArrowLeft": return pick(sameRow.filter((n) => n.x < me.x), (n) => me.x - n.x);
    case "ArrowDown": return pick(all.filter((n) => n.y > me.y), (n) => (n.y - me.y) * 10 + Math.abs(n.x - me.x));
    case "ArrowUp": return pick(all.filter((n) => n.y < me.y), (n) => (me.y - n.y) * 10 + Math.abs(n.x - me.x));
    case "Home": return pick(sameRow.filter((n) => n.x < me.x), (n) => n.x);
    case "End": return pick(sameRow.filter((n) => n.x > me.x), (n) => -n.x);
  }
  return null;
}

function moveFocus(to: SVGGElement): void {
  byId("graph").querySelectorAll('.node[tabindex="0"]').forEach((n) => n.setAttribute("tabindex", "-1"));
  to.setAttribute("tabindex", "0");
  to.focus();
  keyboardFocus = to.dataset.id!;
  revealCommit(to.dataset.id!, false);
}

export function mountCanvas(): void {
  byId("graph").addEventListener("pointerdown", () => { keyboardFocus = null; });
  byId("graph").addEventListener("keydown", (e) => {
    const node = (e.target as Element).closest<SVGGElement>(".node[data-id]");
    if (!node || e.metaKey || e.ctrlKey || e.altKey) return;
    const id = node.dataset.id!;
    if (e.key === "Enter") { e.preventDefault(); keyboardFocus = null; store.update({ selected: id, multi: [], selectedFile: null }); return; }
    if (e.key === " ") {
      e.preventDefault();
      const ui = store.ui;
      const base = ui.multi.length ? ui.multi : ui.selected ? [ui.selected] : [];
      const multi = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      store.update({ multi, selected: multi.includes(id) ? id : ui.selected });
      return;
    }
    const to = nextNode(node, e.key);
    if (to) { e.preventDefault(); moveFocus(to); }
  });
  byId("canvas-wrap").addEventListener("scroll", pinLaneNames, { passive: true });
  const more = byId<HTMLButtonElement>("load-more");
  more.onclick = async () => {
    more.disabled = true;
    try { await loadMore(); } finally { more.disabled = false; }
  };
  window.addEventListener("resize", () => store.update({}));
}
