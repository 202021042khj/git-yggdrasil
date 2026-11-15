// 열린 Pull Request 목록: 리뷰·검사 상태, 브라우저에서 열기, 받아서 체크아웃
import "./PullsSection.css";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { errorText, esc } from "@/lib/html";
import { relTime } from "@/lib/time";
import { openMenu } from "@/ui/menu";
import type { GhChecks, GhPull, GhPullList, GhReview } from "@shared/types/ipc";

let list: GhPullList | null = null;
let loadedFor: string | null = null;
let loading = false;
let error = "";
let loggedIn = false;

const REVIEW: Record<Exclude<GhReview, null>, [string, string]> = {
  APPROVED: ["승인", "ok"],
  CHANGES_REQUESTED: ["수정 요청", "bad"],
  REVIEW_REQUIRED: ["리뷰 대기", "wait"],
};
const CHECKS: Record<Exclude<GhChecks, null>, [string, string, string]> = {
  SUCCESS: ["✓", "ok", "검사 통과"],
  FAILURE: ["✗", "bad", "검사 실패"],
  ERROR: ["✗", "bad", "검사 오류"],
  PENDING: ["…", "wait", "검사 진행 중"],
  EXPECTED: ["…", "wait", "검사 대기"],
};

function row(p: GhPull, i: number): string {
  const review = p.review ? REVIEW[p.review] : null;
  const checks = p.checks ? CHECKS[p.checks] : null;
  const local = store.repo.branches[`pr/${p.number}`] ? " · 로컬 pr/" + p.number : "";
  return `<button type="button" class="pr-row" data-pr="${i}" aria-haspopup="menu">
    <span class="pr-line1"><span class="pr-no">#${p.number}</span><span class="pr-t">${esc(p.title)}</span>
      ${checks ? `<span class="pr-badge ${checks[1]}" title="${checks[2]}" aria-label="${checks[2]}">${checks[0]}</span>` : ""}</span>
    <span class="pr-line2">${p.draft ? '<span class="pr-badge">초안</span>' : ""}${review ? `<span class="pr-badge ${review[1]}">${review[0]}</span>` : ""}
      <span class="muted">${esc(p.head)} → ${esc(p.base)} · ${esc(p.author)} · ${esc(relTime(Date.parse(p.updated)))}${esc(local)}</span></span></button>`;
}

export function renderPulls(): void {
  const box = byId("pr-box");
  const hasGithub = (store.repo.remoteList || []).some((r) => /github\.com[:/]/.test(r.url));
  box.hidden = !store.hasRepo() || !hasGithub || !loggedIn;
  if (box.hidden) return;
  if (loadedFor !== store.repo.root && !loading) void loadPulls();
  byId("pr-list").innerHTML = loading && !list ? `<p class="muted">불러오는 중…</p>`
    : error ? `<p class="muted">${esc(error)}</p>`
    : !list?.pulls.length ? `<p class="muted">열린 PR 이 없습니다.</p>`
    : list.pulls.map(row).join("");
}

export async function loadPulls(): Promise<void> {
  const root = store.repo.root ?? null;
  loading = true;
  loadedFor = root;
  error = "";
  store.update({});
  try {
    const r = await window.ghApi.pulls();
    if (store.repo.root === root) list = r;
  } catch (err) {
    error = errorText(err);
    list = null;
  } finally {
    loading = false;
    store.update({});
  }
}

function openPullMenu(p: GhPull, x: number, y: number): void {
  const remote = list?.remote ?? "origin";
  openMenu(x, y, `#${p.number} ${p.title}`, [
    { label: "브라우저에서 열기", cmd: p.url, onPick: () => void window.ghApi.openUrl(p.url) },
    {
      label: store.repo.branches[`pr/${p.number}`] ? `pr/${p.number} 최신으로 받아 체크아웃` : `받아서 pr/${p.number} 로 체크아웃`,
      cmd: `git fetch ${remote} pull/${p.number}/head && git switch pr/${p.number}`,
      onPick: () => void run({ op: "checkoutPull", args: [p.number, remote], summary: `PR #${p.number} 받아서 체크아웃` }),
    },
  ]);
}

/** 점검용: GitHub 에 접속하지 않고 목록을 넣어 본다 (dev/debug.ts) */
export function injectPulls(data: GhPullList): void {
  loggedIn = true;
  list = data;
  loadedFor = store.repo.root ?? null;
  store.update({});
}

/** GitHub 로그인 상태가 바뀌면 GithubSection 이 알려 준다 */
export function setPullsLogin(on: boolean): void {
  if (on === loggedIn) return;
  loggedIn = on;
  loadedFor = null;
  list = null;
  store.update({});
}

export function mountPulls(): void {
  byId("pr-refresh").onclick = () => void loadPulls();
  byId("pr-list").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-pr]");
    const p = b && list?.pulls[Number(b.dataset.pr)];
    if (!b || !p) return;
    const r = b.getBoundingClientRect();
    openPullMenu(p, r.left + 12, r.bottom);
  });
}
