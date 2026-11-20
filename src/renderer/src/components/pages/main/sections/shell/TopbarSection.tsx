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
import { t } from "@shared/i18n/i18n";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";

/** 되돌리기: 앱에서 한 조작 중 브랜치 위치를 바꾼 것을 하나씩 (커밋류는 변경을 Staged 로 남김) */
const undo = () => {
  if (!store.hasRepo()) return;
  void run({ op: "undo", args: [], summary: t("top.undo") });
};

/** 다시 실행: 되돌린 조작을 다시 적용 (새 조작을 하면 기록이 사라진다) */
const redo = () => {
  if (!store.hasRepo()) return;
  if (!store.ui.redoCount) { toast(t("top.noRedo")); return; }
  void run({ op: "redo", args: [], summary: t("top.redo") });
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

  const handlePull = () => void run({ op: "pull", args: [repo.head, ui.pullMode], summary: t("top.pullSummary", { branch: repo.head, mode: ui.pullMode }) });

  const handlePush = () => {
    const force = !!remote && ahead > 0 && behind > 0;
    if (force && !window.confirm(t("top.confirmForce", { branch: repo.head, n: behind }))) return;
    void run({ op: "push", args: [repo.head], summary: remote ? (force ? t("top.pushForce", { branch: repo.head }) : t("pv.push", { branch: repo.head })) : t("pv.publish", { branch: repo.head }), extra: { force } });
  };

  const pullTitle = !b ? t("top.pullNoBranch") : !remote ? t("top.notOnRemote", { branch: b }) : behind ? t("top.pullTitle", { remote, n: behind, mode: ui.pullMode }) : t("top.nothingToPull");
  const pushTitle = !b ? t("top.pushNoBranch") : publish ? t("top.publishTitle", { branch: b }) : ahead && behind ? t("top.diverged") : ahead ? t("top.pushTitle", { n: ahead }) : t("top.nothingToPush");

  return (
    <header className="topbar">
      <strong className="brand">
        <LogoMark />
        <span className="brand-name">Yggdrasil</span>
      </strong>
      <button type="button" id="open-repo" className="small" title="⌘O" onClick={() => void open(window.gitApi.pick())}>{t("top.open")}</button>
      <GithubAccountButton />
      <span className="sub" id="repo-path" title={repo.root || ""}>{repo.root || ""}</span>
      <div className="spacer" />
      <div className="sync" role="group" aria-label={t("top.sync")}>
        <button type="button" id="tb-fetch" className="sync-btn" title="git fetch --all --prune" onClick={() => void run({ op: "fetch", args: [], summary: t("top.fetchSummary") })}>Fetch</button>
        <button type="button" id="tb-pull" className={`sync-btn${behind ? " hot" : ""}`} disabled={!remote || !behind || busyOrOp} title={pullTitle} onClick={handlePull}>
          <span className="n">↓{behind}</span>Pull
        </button>
        <button type="button" id="tb-push" className={`sync-btn${b && (publish || (ahead && !behind)) ? " hot" : ""}`} disabled={(!publish && !ahead) || busyOrOp} title={pushTitle} onClick={handlePush}>
          {publish ? "Publish" : <><span className="n">↑{ahead}</span>Push</>}
        </button>
      </div>
      <button type="button" id="undo" title={t("top.undoTitle", { n: ui.undoCount })} onClick={undo}>
        <Icon name="undo" />{t("top.undo")}
      </button>
      <button type="button" id="redo" disabled={!ui.redoCount || ui.busy} title={ui.redoCount ? t("top.redoTitle", { n: ui.redoCount }) : t("top.redoNone")} onClick={redo}>
        <Icon name="redo" />{t("top.redo")}
      </button>
      <button type="button" id="search-open" title="⌘K" onClick={openSearch}>{t("top.search")}</button>
      <button type="button" id="help-toggle" aria-expanded={ui.helpOpen} onClick={() => store.update({ helpOpen: !ui.helpOpen })}>{t("top.help")}</button>
    </header>
  );
};

export default TopbarSection;
