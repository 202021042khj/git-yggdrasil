// 상단: 저장소 열기 · 경로 · Fetch / Pull / Push · 되돌리기 · 도움말
import "./TopbarSection.css";
import { run } from "@/app/actions";
import { open } from "@/app/repoSession";
import { store } from "@/app/store";
import { byId } from "@/lib/dom";
import { syncInfo } from "@/model/graph";
import { toast } from "@/ui/toast";

export function renderTopbar(): void {
  const s = store.repo;
  const undoBtn = byId<HTMLButtonElement>("undo"), redoBtn = byId<HTMLButtonElement>("redo");
  undoBtn.title = `⌘Z · 되돌릴 수 있는 조작 ${store.ui.undoCount}개`;
  redoBtn.disabled = !store.ui.redoCount || store.ui.busy;
  redoBtn.title = store.ui.redoCount ? `⌘⇧Z · 다시 실행할 조작 ${store.ui.redoCount}개` : "⌘⇧Z · 다시 실행할 조작이 없습니다";
  const path = byId("repo-path");
  path.textContent = s.root || "";
  path.title = s.root || "";
  const pull = byId<HTMLButtonElement>("tb-pull"), push = byId<HTMLButtonElement>("tb-push");
  const b = s.head;
  const { remote, ahead, behind } = b ? syncInfo(s, b) : { remote: null, ahead: 0, behind: 0 };
  const busyOrOp = !!s.op || store.ui.busy || !b;
  pull.innerHTML = `<span class="n">↓${behind}</span>Pull`;
  pull.disabled = !remote || !behind || busyOrOp;
  pull.classList.toggle("hot", !!behind);
  pull.title = !b ? "브랜치를 체크아웃해야 pull 할 수 있습니다" : !remote ? `${b} 는 아직 원격에 없습니다` : behind ? `${remote} 의 커밋 ${behind}개를 받습니다 (${store.ui.pullMode})` : "받을 커밋이 없습니다";
  const publish = !remote;
  push.innerHTML = publish ? "Publish" : `<span class="n">↑${ahead}</span>Push`;
  push.disabled = (!publish && !ahead) || busyOrOp;
  push.classList.toggle("hot", !!b && (publish || (!!ahead && !behind)));
  push.title = !b ? "브랜치를 체크아웃해야 push 할 수 있습니다" : publish ? `${b} 를 원격에 처음 올립니다` : ahead && behind ? "원격과 갈라졌습니다. 먼저 Pull 하거나, push 하면 덮어씁니다(확인 후)" : ahead ? `커밋 ${ahead}개를 보냅니다` : "보낼 커밋이 없습니다";
}

export function mountTopbar(): void {
  byId("open-repo").onclick = () => void open(window.gitApi.pick());
  byId("tb-fetch").onclick = () => void run({ op: "fetch", args: [], summary: "원격 정보 받아오기 (fetch)" });
  byId("tb-pull").onclick = () => {
    const s = store.repo;
    void run({ op: "pull", args: [s.head, store.ui.pullMode], summary: `${s.head} pull (${store.ui.pullMode})` });
  };
  byId("tb-push").onclick = () => {
    const s = store.repo;
    const { remote, ahead, behind } = syncInfo(s, s.head);
    const force = !!remote && ahead > 0 && behind > 0;
    if (force && !window.confirm(`${s.head} 가 원격과 갈라졌습니다. push 하면 원격의 커밋 ${behind}개를 덮어씁니다 (--force-with-lease). 계속할까요?`)) return;
    void run({ op: "push", args: [s.head], summary: remote ? `${s.head} push${force ? " (덮어쓰기)" : ""}` : `${s.head} 를 원격에 처음 publish`, extra: { force } });
  };
  byId("undo").onclick = undo;
  byId("redo").onclick = redo;
  byId("help-toggle").onclick = () => byId("help").classList.toggle("hidden");
  // ⌘Z: 입력 중이 아닐 때만 (입력 중에는 텍스트 되돌리기)
  document.addEventListener("keydown", (e) => {
    if ((e.target as Element).closest?.("input, textarea")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
  });
}

/** 되돌리기: 앱에서 한 조작 중 브랜치 위치를 바꾼 것을 하나씩 (커밋류는 변경을 Staged 로 남김) */
function undo(): void {
  if (!store.hasRepo()) return;
  void run({ op: "undo", args: [], summary: "되돌리기" });
}

/** 다시 실행: 되돌린 조작을 다시 적용 (새 조작을 하면 기록이 사라진다) */
function redo(): void {
  if (!store.hasRepo()) return;
  if (!store.ui.redoCount) { toast("다시 실행할 작업이 없습니다."); return; }
  void run({ op: "redo", args: [], summary: "다시 실행" });
}
