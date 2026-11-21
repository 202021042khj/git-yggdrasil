import "./SidebarSection.css";

import type { KeyboardEvent } from "react";

import Dropdown from "@/components/ui/Dropdown";
import Icon from "@/components/common/Icon";
import { askText } from "@/components/ui/dialogUtils";
import { short } from "@/lib/html";
import { run } from "@/app/actions";
import { openContextMenu } from "@/interactions/contextMenu";
import { selectBranch } from "@/interactions/drag";
import { branchOrder, syncInfo } from "@/model/graph";
import { layout } from "@/model/layout";
import { saveSettings } from "@/components/pages/main/sections/dialogs/settingsUtils";
import { t } from "@shared/i18n/i18n";
import RichText from "@/components/common/RichText";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";

const PULL_OPTIONS = [{ value: "merge", label: "merge" }, { value: "rebase", label: "rebase" }] as const;

const checkout = (b: string) => void run({ op: "checkout", args: [b], summary: t("act.switchTo", { branch: b }) });

/** 사이드바: 저장소 · 브랜치 목록 (앞섬/뒤처짐, pull 배지) · 새 브랜치 · pull 방식 */
const SidebarSection = ({ ui, repo }: UseMainLogicResult) => {
  const lanes = layout(repo).lanes;
  const colorOf = (b: string) => lanes.find((l) => l.name === b)?.color || "var(--lane-remote)";


  // 키보드: Enter 는 checkout, Shift+F10·메뉴 키는 할 일 메뉴
  const handleRowKey = (e: KeyboardEvent<HTMLDivElement>, b: string) => {
    if (e.key === "Enter" && b !== repo.head) { e.preventDefault(); checkout(b); }
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      openContextMenu({ kind: "label", branch: b }, r.left + 20, r.bottom);
    }
  };

  const handleNewBranch = async () => {
    const from = repo.head || (repo.detached ? short(repo.detached) : "");
    const name = await askText(t("ask.newBranchName"), "feat/", t("sb.newBranchHint", { from }));
    if (name) void run({ op: "switchCreate", args: [name], summary: t("sb.newBranchSummary", { from, name }) });
  };

  return (
    <>
      <h3>{t("sb.repo")}</h3>
      <div id="repo-tree">
        <div className="tree">
          <div className="repo"><Icon name="folder" />{repo.repoName || ""}</div>
          {branchOrder(repo).map((b) => {
            const { remote, ahead, behind } = syncInfo(repo, b);
            const text = ahead && behind ? `⚠ ↑${ahead} ↓${behind}` : ahead ? `↑${ahead}` : behind ? `↓${behind}` : "✓";
            const wt = (repo.worktrees || []).find((w) => w.branch === b && !w.current);
            const isHead = b === repo.head;
            return (
              <div
                key={b}
                className={`br${isHead ? " head" : ""}${b === ui.selectedBranch ? " selected" : ""}`}
                aria-pressed={b === ui.selectedBranch}
                data-checkout={b}
                role="button"
                tabIndex={0}
                aria-label={t("graph.branchLabel", { name: b, head: isHead })}
                title={t("sb.branchTip")}
                onClick={() => selectBranch(b)}
                onDoubleClick={() => { if (!isHead) checkout(b); }}
                onKeyDown={(e) => handleRowKey(e, b)}
              >
                <span className="dot" style={{ background: colorOf(b) }} />
                {isHead && "◉ "}{b}
                {wt && <span className="badge wt" title={t("sb.wtTip", { path: wt.path })}>{t("sb.wtBadge")}</span>}
                {!remote
                  ? <span className="badge">{t("sb.local")}</span>
                  : behind
                    ? <button type="button" className="badge pull" title={t("sb.pullTip", { mode: ui.pullMode })} onClick={() => void run({ op: "pull", args: [b, ui.pullMode], summary: t("top.pullSummary", { branch: b, mode: ui.pullMode }) })}>{text} pull</button>
                    : <span className="badge">{text}</span>}
              </div>
            );
          })}
          {!repo.head && repo.detached && (
            <div className="detached-note"><RichText text={t("sb.detached", { id: short(repo.detached) })} /></div>
          )}
        </div>
      </div>
      <div className="repo-tools">
        <button type="button" id="new-branch" className="small" title="git switch -c" onClick={() => void handleNewBranch()}>{t("sb.newBranch")}</button>
        <span className="muted">pull</span>
        <Dropdown id="pull-mode" label={t("set.pull")} value={ui.pullMode} options={[...PULL_OPTIONS]} onChange={(v) => void saveSettings({ pullMode: v })} />
      </div>
    </>
  );
};

export default SidebarSection;
