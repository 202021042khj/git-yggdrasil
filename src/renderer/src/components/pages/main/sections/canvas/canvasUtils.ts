// 캔버스를 밖에서 다루는 함수 (찾기 · reflog · 드래그 · 키보드에서 부른다)
import { store } from "@/app/store";

/** 화살표로 옮겨 간 커밋 (다시 그려도 초점을 그 자리에 둔다). 클릭·Enter 로 고르면 고른 커밋을 따른다 */
export const keyboardFocus = { id: null as string | null };

const wrap = () => document.getElementById("canvas-wrap");

/** 레인 이름과 push 띠의 안내 글자를 가로 스크롤과 상관없이 보이는 화면 왼쪽에 붙여 둔다 */
export const pinLaneNames = () => {
  const x = wrap()?.scrollLeft ?? 0;
  for (const id of ["lane-names", "lane-names-preview", "remote-band-label"]) document.getElementById(id)?.setAttribute("transform", `translate(${x},0)`);
};

/** 커밋이 보이게 스크롤하고 (select 면) 고른다. 그래프에 없으면 false */
export const revealCommit = (id: string, select = true): boolean => {
  if (select) {
    store.update({ selected: id, selectedFile: null });
    store.flush();
  }
  const node = document.querySelector(`#graph .node[data-id="${CSS.escape(id)}"]`);
  const w = wrap();
  if (!node || !w) return false;
  const r = node.getBoundingClientRect(), b = w.getBoundingClientRect();
  w.scrollLeft += r.left - b.left - b.width / 2;
  w.scrollTop += r.top - b.top - b.height / 2;
  return true;
};

/** 화살표 이동: ←→ 같은 줄 앞뒤, ↑↓ 위아래 줄의 가장 가까운 커밋, Home·End 줄의 처음과 끝 */
export const nextNode = (from: SVGGElement, key: string): SVGGElement | null => {
  const at = (el: Element) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(el.getAttribute("transform") || "");
    return { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) };
  };
  const me = at(from);
  const graph = from.ownerSVGElement ?? document.getElementById("graph");
  const all = [...(graph?.querySelectorAll<SVGGElement>(".node[data-id]") ?? [])].map((el) => ({ el, ...at(el) })).filter((n) => n.el !== from);
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
};

/** 키보드로 다른 커밋에 초점을 옮긴다 (고르지는 않고 보이게만) */
export const moveFocus = (to: SVGGElement) => {
  to.ownerSVGElement?.querySelectorAll('.node[tabindex="0"]').forEach((n) => n.setAttribute("tabindex", "-1"));
  to.setAttribute("tabindex", "0");
  to.focus();
  keyboardFocus.id = to.dataset.id!;
  revealCommit(to.dataset.id!, false);
};
