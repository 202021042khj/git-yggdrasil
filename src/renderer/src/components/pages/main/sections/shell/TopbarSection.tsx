import "./TopbarSection.css";

import { useEffect } from "react";

import LogoMark from "@/components/common/LogoMark";
import Icon from "@/components/common/Icon";
import { toast } from "@/components/ui/toastUtils";
import { run } from "@/app/actions";
import { open } from "@/app/repoSession";
import { store } from "@/app/store";
import { syncInfo } from "@/model/graph";
import { openSearch } from "@/components/pages/main/sections/dialogs/searchUtils";
import GithubAccountButton from "@/components/pages/main/sections/dialogs/GithubAccountButton";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";

/** 되돌리기: 앱에서 한 조작 중 브랜치 위치를 바꾼 것을 하나씩 (커밋류는 변경을 Staged 로 남김) */
const undo = () => {
  if (!store.hasRepo()) return;
  void run({ op: "undo", args: [], summary: "되돌리기" });
};

/** 다시 실행: 되돌린 조작을 다시 적용 (새 조작을 하면 기록이 사라진다) */
const redo = () => {
  if (!store.hasRepo()) return;
  if (!store.ui.redoCount) { toast("다시 실행할 작업이 없습니다."); return; }
  void run({ op: "redo", args: [], summary: "다시 실행" });
};

/** 상단: 저장소 열기 · 경로 · Fetch / Pull / Push · 되돌리기 · 찾기 · 도움말 */
const TopbarSection = ({ ui, repo }: UseMainLogicResult) => {
  const b = repo.head;
  const { remote, ahead, behind } = b ? syncInfo(repo, b) : { remote: null, ahead: 0, behind: 0 };
  const busyOrOp = !!repo.op || ui.busy || !b;
  const publish = !remote;

  // ⌘Z: 입력 중이 아닐 때만 (입력 중에는 텍스트 되돌리기)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.("input, textarea")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const handlePull = () => void run({ op: "pull", args: [repo.head, ui.pullMode], summary: `${repo.head} pull (${ui.pullMode})` });

  const handlePush = () => {
    const force = !!remote && ahead > 0 && behind > 0;
    if (force && !window.confirm(`${repo.head} 가 원격과 갈라졌습니다. push 하면 원격의 커밋 ${behind}개를 덮어씁니다 (--force-with-lease). 계속할까요?`)) return;
    void run({ op: "push", args: [repo.head], summary: remote ? `${repo.head} push${force ? " (덮어쓰기)" : ""}` : `${repo.head} 를 원격에 처음 publish`, extra: { force } });
  };

  const pullTitle = !b ? "브랜치를 체크아웃해야 pull 할 수 있습니다" : !remote ? `${b} 는 아직 원격에 없습니다` : behind ? `${remote} 의 커밋 ${behind}개를 받습니다 (${ui.pullMode})` : "받을 커밋이 없습니다";
  const pushTitle = !b ? "브랜치를 체크아웃해야 push 할 수 있습니다" : publish ? `${b} 를 원격에 처음 올립니다` : ahead && behind ? "원격과 갈라졌습니다. 먼저 Pull 하거나, push 하면 덮어씁니다(확인 후)" : ahead ? `커밋 ${ahead}개를 보냅니다` : "보낼 커밋이 없습니다";

  return (
    <header className="topbar">
      <strong className="brand">
        <LogoMark />
        <span className="brand-name">Yggdrasil</span>
      </strong>
      <button type="button" id="open-repo" className="small" title="⌘O" onClick={() => void open(window.gitApi.pick())}>저장소 열기</button>
      <GithubAccountButton />
      <span className="sub" id="repo-path" title={repo.root || ""}>{repo.root || ""}</span>
      <div className="spacer" />
      <div className="sync" role="group" aria-label="원격과 동기화">
        <button type="button" id="tb-fetch" className="sync-btn" title="git fetch --all --prune" onClick={() => void run({ op: "fetch", args: [], summary: "원격 정보 받아오기 (fetch)" })}>Fetch</button>
        <button type="button" id="tb-pull" className={`sync-btn${behind ? " hot" : ""}`} disabled={!remote || !behind || busyOrOp} title={pullTitle} onClick={handlePull}>
          <span className="n">↓{behind}</span>Pull
        </button>
        <button type="button" id="tb-push" className={`sync-btn${b && (publish || (ahead && !behind)) ? " hot" : ""}`} disabled={(!publish && !ahead) || busyOrOp} title={pushTitle} onClick={handlePush}>
          {publish ? "Publish" : <><span className="n">↑{ahead}</span>Push</>}
        </button>
      </div>
      <button type="button" id="undo" title={`⌘Z · 되돌릴 수 있는 조작 ${ui.undoCount}개`} onClick={undo}>
        <Icon name="undo" />되돌리기
      </button>
      <button type="button" id="redo" disabled={!ui.redoCount || ui.busy} title={ui.redoCount ? `⌘⇧Z · 다시 실행할 조작 ${ui.redoCount}개` : "⌘⇧Z · 다시 실행할 조작이 없습니다"} onClick={redo}>
        <Icon name="redo" />다시 실행
      </button>
      <button type="button" id="search-open" title="⌘K" onClick={openSearch}>찾기</button>
      <button type="button" id="help-toggle" aria-expanded={ui.helpOpen} onClick={() => store.update({ helpOpen: !ui.helpOpen })}>도움말</button>
    </header>
  );
};

export default TopbarSection;
