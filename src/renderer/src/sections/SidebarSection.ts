// 사이드바: 저장소 · 브랜치 목록 (앞섬/뒤처짐, pull 배지) · 새 브랜치 · pull 방식
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { PULL_MODE_KEY } from "@/constants/storage";
import { byId } from "@/lib/dom";
import { esc, short } from "@/lib/html";
import { branchOrder, syncInfo } from "@/model/graph";
import { layout } from "@/model/layout";
import { askText } from "@/ui/dialog";

export function renderSidebar(): void {
  const s = store.repo;
  const lanes = layout(s).lanes;
  const colorOf = (b: string) => lanes.find((l) => l.name === b)?.color || "var(--lane-remote)";
  const rows = branchOrder(s).map((b) => {
    const { remote, ahead, behind } = syncInfo(s, b);
    let badge: string;
    if (!remote) badge = `<span class="badge">로컬</span>`;
    else {
      const text = ahead && behind ? `⚠ ↑${ahead} ↓${behind}` : ahead ? `↑${ahead}` : behind ? `↓${behind}` : "✓";
      badge = behind
        ? `<span class="badge pull" data-pull="${esc(b)}" title="클릭: pull (${store.ui.pullMode})">${text} pull</span>`
        : `<span class="badge">${text}</span>`;
    }
    return `<div class="br ${b === s.head ? "head" : ""}" data-checkout="${esc(b)}" title="더블클릭: checkout · 오른쪽 클릭: 메뉴">
      <span class="dot" style="background:${colorOf(b)}"></span>${b === s.head ? "◉ " : ""}${esc(b)}${badge}</div>`;
  });
  const detached = !s.head && s.detached
    ? `<div class="detached-note">브랜치 없이 <code>${short(s.detached)}</code> 를 보는 중입니다. 여기서 이어서 작업하려면 새 브랜치를 만드세요.</div>` : "";
  byId("repo-tree").innerHTML = `<div class="tree"><div class="repo"><svg class="i" aria-hidden="true"><use href="#i-folder"/></svg>${esc(s.repoName || "")}</div>${rows.join("")}${detached}</div>`;
  byId<HTMLSelectElement>("pull-mode").value = store.ui.pullMode;
}

export function mountSidebar(): void {
  try {
    const saved = localStorage.getItem(PULL_MODE_KEY);
    if (saved === "merge" || saved === "rebase") store.update({ pullMode: saved });
  } catch { /* 기본 merge */ }
  byId("repo-tree").addEventListener("click", (e) => {
    const p = (e.target as Element).closest<HTMLElement>("[data-pull]");
    if (!p) return;
    const b = p.dataset.pull!;
    void run({ op: "pull", args: [b, store.ui.pullMode], summary: `${b} pull (${store.ui.pullMode})` });
  });
  byId("repo-tree").addEventListener("dblclick", (e) => {
    const row = (e.target as Element).closest<HTMLElement>("[data-checkout]");
    if (row && row.dataset.checkout !== store.repo.head) void run({ op: "checkout", args: [row.dataset.checkout], summary: `${row.dataset.checkout} 로 전환` });
  });
  byId<HTMLSelectElement>("pull-mode").onchange = (e) => {
    const mode = (e.target as HTMLSelectElement).value as "merge" | "rebase";
    try { localStorage.setItem(PULL_MODE_KEY, mode); } catch { /* 이번 실행에서만 */ }
    store.update({ pullMode: mode });
  };
  byId("new-branch").onclick = async () => {
    const s = store.repo;
    const from = s.head || (s.detached ? short(s.detached) : "");
    const name = await askText("새 브랜치 이름", "feat/", `${from} 에서 새 브랜치를 만들고 전환합니다 (git switch -c).`);
    if (name) void run({ op: "switchCreate", args: [name], summary: `${from} 에서 새 브랜치 ${name} 를 만들고 전환` });
  };
  // 캔버스의 이름표 더블클릭도 checkout
  document.addEventListener("dblclick", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("#graph .ref.local[data-branch]");
    if (el && el.dataset.branch !== store.repo.head) void run({ op: "checkout", args: [el.dataset.branch], summary: `${el.dataset.branch} 로 전환` });
  });
}
