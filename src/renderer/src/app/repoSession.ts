// 저장소 열기 · 최근 목록 · 새로고침 · 더 불러오기
import { RECENT_KEY, RECENT_LIMIT } from "@/constants/storage";
import { byId } from "@/lib/dom";
import { errorText } from "@/lib/html";
import { store } from "@/app/store";
import { NO_FILTER } from "@/model/filter";
import { showNotice } from "@/components/ui/dialogUtils";
import { toast } from "@/components/ui/toastUtils";
import { t } from "@shared/i18n/i18n";
import type { RepoState } from "@shared/types/repo";

let shownRoot: string | null = null;
/** 드래그 중에는 화면을 바꾸지 않는다 (끝나면 다음 변경 때 반영) */
let holdRefresh = () => false;
export const setRefreshGuard = (fn: () => boolean) => { holdRefresh = fn; };

/** 실제 저장소 상태를 화면이 쓰는 모양으로 맞춘다 */
function adapt(repo: RepoState): RepoState {
  if (!repo.head && repo.op?.branch && repo.branches[repo.op.branch]) repo.head = repo.op.branch; // rebase 도중
  repo.stash ||= [];
  repo.working.conflicted ||= [];
  return repo;
}

/** 새로 읽은 저장소 상태를 화면에 반영 */
export function show(repo: RepoState | null): void {
  if (!repo || holdRefresh()) return;
  const firstOpen = shownRoot !== repo.root;
  shownRoot = repo.root ?? null;
  store.update({ repo: adapt(repo), ...(firstOpen ? { log: [], selected: null, multi: [], selectedFile: null, undoCount: 0, redoCount: 0, filter: NO_FILTER } : {}) });
  store.flush();
  if (firstOpen) {
    scrollToHead();
    if (repo.op) toast(t("session.paused", { title: repo.op.title }));
  }
}

/** 처음 열 때는 최근 작업(HEAD)이 보이게 스크롤한다. 자동 새로고침 때는 보던 자리를 유지한다. */
function scrollToHead(): void {
  const s = store.repo;
  const wrap = byId("canvas-wrap");
  const headId = (s.head && s.branches[s.head]) || s.detached || "";
  const tip = document.querySelector(`#graph .node[data-id="${CSS.escape(headId)}"]`);
  if (!tip) { wrap.scrollLeft = wrap.scrollWidth; return; }
  const r = tip.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  wrap.scrollLeft += r.left - w.left - w.width * 0.7;
  wrap.scrollTop += r.top - w.top - w.height * 0.3;
}

export function recent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
function remember(root: string): void {
  try {
    const list = recent().filter((r) => r !== root);
    localStorage.setItem(RECENT_KEY, JSON.stringify([root, ...list].slice(0, RECENT_LIMIT)));
  } catch { /* 저장 못 해도 동작에는 지장 없음 */ }
}

/** 저장소 열기 요청(선택 창·경로·clone)의 결과를 받아 화면에 띄운다 */
export async function open(promise: Promise<RepoState | null>): Promise<void> {
  try {
    const repo = await promise;
    if (!repo) return;
    if (repo.root) remember(repo.root);
    show(repo);
  } catch (err) {
    // 원격 안내가 붙은 오류(여러 줄)는 알림 창으로: 첫 줄 = 원인, 나머지 = 해결 방법과 git 원문
    const text = errorText(err);
    const [title, ...rest] = text.split("\n");
    if (rest.length) {
      const body = rest.join("\n");
      const [fix, raw] = body.split(/\n\n\(git: /);
      showNotice(title, fix.trim(), raw ? raw.replace(/\)$/, "") : "");
    } else toast(text);
  }
}

export async function refresh(): Promise<void> {
  try { show(await window.gitApi.read()); } catch { /* 저장소가 사라졌으면 다음 열기에서 알린다 */ }
}

/** 오래된 커밋 더 불러오기: 지금 보던 자리(오른쪽 끝 기준)를 유지한다 */
export async function loadMore(): Promise<void> {
  const wrap = byId("canvas-wrap");
  const fromRight = wrap.scrollWidth - wrap.scrollLeft;
  const repo = await window.gitApi.more();
  if (!repo) return;
  show(repo);
  wrap.scrollLeft = wrap.scrollWidth - fromRight;
}
