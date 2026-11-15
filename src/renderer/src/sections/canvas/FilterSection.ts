// 그래프 필터 막대: 브랜치 고르기(나머지 숨김) · 작성자 · 기간(맞지 않는 커밋 흐리게)
import "./FilterSection.css";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc } from "@/lib/html";
import { dimmedCommits, isFiltering, NO_FILTER, visibleRepo, type GraphFilter } from "@/model/filter";

const DAY = 24 * 60 * 60 * 1000;
const setFilter = (patch: Partial<GraphFilter>) => store.update({ filter: { ...store.ui.filter, ...patch } });

export function renderFilter(): void {
  const s = store.repo, f = store.ui.filter;
  const all = Object.keys(s.branches).sort();
  const chosen = f.branches ? new Set(f.branches) : null;
  byId("filter-branch-list").innerHTML = all.map((b) => {
    const on = !chosen || chosen.has(b) || b === s.head;
    return `<label class="fb-row"><input type="checkbox" data-fb="${esc(b)}" ${on ? "checked" : ""} ${b === s.head ? "disabled title=\"체크아웃한 브랜치는 항상 보입니다\"" : ""}> ${esc(b)}${b === s.head ? ' <span class="muted">(현재)</span>' : ""}</label>`;
  }).join("");
  const shownBranches = chosen ? all.filter((b) => chosen.has(b) || b === s.head).length : all.length;
  byId("filter-branches-label").textContent = chosen ? `브랜치: ${shownBranches} / ${all.length}` : "브랜치: 전부";
  byId("filter-branches").classList.toggle("on", !!chosen);

  const author = byId<HTMLInputElement>("filter-author");
  if (document.activeElement !== author) author.value = f.author;
  const since = byId<HTMLSelectElement>("filter-since");
  since.value = f.since === null ? "" : since.value || "";

  const filtering = isFiltering(f);
  byId("filter-clear").hidden = !filtering;
  let summary = "";
  if (filtering) {
    const vis = visibleRepo(s, f);
    const total = Object.keys(vis.commits).length;
    const dim = dimmedCommits(vis, f).size;
    const hidden = Object.keys(s.commits).length - total;
    summary = [hidden && `${hidden.toLocaleString()}개 숨김`, (f.author.trim() || f.since !== null) && `${(total - dim).toLocaleString()}개 해당`].filter(Boolean).join(" · ");
  }
  byId("filter-summary").textContent = summary;
}

export function mountFilter(): void {
  byId("filter-branch-list").addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.fb) return;
    const s = store.repo;
    const all = Object.keys(s.branches);
    const cur = new Set(store.ui.filter.branches ?? all);
    if (t.checked) cur.add(t.dataset.fb); else cur.delete(t.dataset.fb);
    const next = all.every((b) => cur.has(b) || b === s.head) ? null : [...cur];
    setFilter({ branches: next });
  });
  byId("filter-branches").addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-fb-all]")) setFilter({ branches: null });
    else if (t.closest("[data-fb-head]")) setFilter({ branches: [] });
  });
  // 바깥을 누르면 브랜치 목록을 닫는다
  document.addEventListener("click", (e) => {
    const d = byId<HTMLDetailsElement>("filter-branches");
    if (d.open && !d.contains(e.target as Node)) d.open = false;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  byId<HTMLInputElement>("filter-author").addEventListener("input", (e) => {
    clearTimeout(timer);
    const v = (e.target as HTMLInputElement).value;
    timer = setTimeout(() => setFilter({ author: v }), 200);
  });
  byId<HTMLSelectElement>("filter-since").addEventListener("change", (e) => {
    const days = (e.target as HTMLSelectElement).value;
    setFilter({ since: days ? Date.now() - Number(days) * DAY : null });
  });
  byId("filter-clear").onclick = () => {
    byId<HTMLSelectElement>("filter-since").value = "";
    store.update({ filter: NO_FILTER });
  };
}
