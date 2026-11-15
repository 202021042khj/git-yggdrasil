// 서브모듈 · worktree · Git LFS 안내 (사이드바)
import "./ExtrasSection.css";
import { run } from "@/app/actions";
import { open } from "@/app/repoSession";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { esc, short } from "@/lib/html";
import { confirmAction } from "@/ui/dialog";
import type { SubmoduleInfo, WorktreeInfo } from "@shared/types/repo";

const SUB_STATE: Record<SubmoduleInfo["state"], [string, string]> = {
  ok: ["", ""],
  uninitialized: ["받지 않음", "wait"],
  modified: ["기록과 다른 커밋", "wait"],
  conflict: ["충돌", "bad"],
};

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, "")}/${b}`;

function worktreeRow(w: WorktreeInfo, i: number): string {
  const badges = [w.current && "지금 연 곳", w.main && "원래 저장소", w.locked && "잠김", w.prunable && "폴더 없음"].filter(Boolean) as string[];
  return `<div class="ex-row" title="${esc(w.path)}">
    <span class="ex-main"><span class="ex-name">${esc(base(w.path))}</span><span class="muted ex-sub">${w.branch ? esc(w.branch) : `브랜치 없음 ${short(w.head)}`}${badges.map((b) => ` · ${b}`).join("")}</span></span>
    ${w.current || w.prunable ? "" : `<button type="button" class="small" data-wt-open="${i}">열기</button>`}
    ${w.main || w.current ? "" : `<button type="button" class="small" data-wt-del="${i}">${w.prunable ? "정리" : "지우기"}</button>`}</div>`;
}

function submoduleRow(m: SubmoduleInfo, i: number): string {
  const [label, cls] = SUB_STATE[m.state];
  return `<div class="ex-row" title="${esc(m.url || m.path)}">
    <span class="ex-main"><span class="ex-name">${esc(m.path)}</span><span class="muted ex-sub">${short(m.sha)}${m.describe ? ` (${esc(m.describe)})` : ""}${label ? ` · <span class="pr-badge ${cls}">${label}</span>` : ""}</span></span>
    ${m.state === "ok" ? "" : `<button type="button" class="small" data-sub-update="${i}">${m.state === "uninitialized" ? "받기" : "맞추기"}</button>`}
    ${m.state === "uninitialized" ? "" : `<button type="button" class="small" data-sub-open="${i}">열기</button>`}</div>`;
}

export function renderExtras(): void {
  const s = store.repo;
  const wts = s.worktrees ?? [];
  const subs = s.submodules ?? [];
  const parts: string[] = [];
  if (wts.length > 1) parts.push(`<h3>worktree</h3>${wts.map(worktreeRow).join("")}`);
  if (subs.length) {
    const pending = subs.filter((m) => m.state !== "ok").length;
    parts.push(`<div class="pr-head"><h3>서브모듈</h3>${pending ? `<button type="button" class="small" data-sub-all>전부 맞추기</button>` : ""}</div>${subs.map(submoduleRow).join("")}`);
  }
  if (s.lfs) {
    parts.push(s.lfs.installed
      ? `<p class="muted ex-note">Git LFS 파일 ${s.lfs.files.length}개 (파일 트리에 LFS 표시)</p>`
      : `<p class="ex-note warn">이 저장소는 Git LFS 를 씁니다. git-lfs 가 설치되어 있지 않아 큰 파일이 실제 내용 대신 포인터로 보입니다. 터미널에서 <code>brew install git-lfs</code> 와 <code>git lfs install</code> 을 실행한 뒤 다시 여세요.</p>`);
  }
  const box = byId("extras-box");
  box.hidden = !parts.length;
  byId("extras-body").innerHTML = parts.join("");
}

export function mountExtras(): void {
  byId("extras-body").addEventListener("click", (e) => {
    const t = e.target as Element;
    const s = store.repo;
    const wts = s.worktrees ?? [], subs = s.submodules ?? [];
    const pick = (attr: string) => t.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr);
    const wo = pick("data-wt-open"), wd = pick("data-wt-del"), su = pick("data-sub-update"), so = pick("data-sub-open");
    if (wo != null) void open(window.gitApi.open(wts[Number(wo)].path));
    else if (wd != null) {
      const w = wts[Number(wd)];
      if (w.prunable || confirmAction(`worktree ${w.path} 를 지울까요?\n폴더가 지워지고 ${w.branch ?? "이 체크아웃"} 은(는) 다른 곳에서 체크아웃할 수 있게 됩니다. 브랜치와 커밋은 그대로 남습니다.`)) {
        void run({ op: "worktreeRemove", args: [w.path], summary: `worktree ${base(w.path)} ${w.prunable ? "정리" : "지우기"}` });
      }
    } else if (su != null) void run({ op: "submoduleUpdate", args: [subs[Number(su)].path], summary: `서브모듈 ${subs[Number(su)].path} 받기` });
    else if (so != null && s.root) void open(window.gitApi.open(join(s.root, subs[Number(so)].path)));
    else if (t.closest("[data-sub-all]")) void run({ op: "submoduleUpdate", args: [null], summary: "서브모듈 전부 받기" });
  });
}

/** 브랜치를 다른 폴더에 함께 체크아웃 (오른쪽 클릭 메뉴에서) */
export async function addWorktree(branch: string): Promise<void> {
  const parent = await window.gitApi.pickDir(`${branch} 를 체크아웃할 폴더를 넣을 곳`);
  if (!parent) return;
  await run({ op: "worktreeAdd", args: [branch, parent], summary: `${branch} 를 다른 폴더에 체크아웃 (worktree)` });
}
