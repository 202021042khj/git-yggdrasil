import "./SidebarSection.css";

import { useEffect, type KeyboardEvent } from "react";

import Dropdown from "@/components/ui/Dropdown";
import Icon from "@/components/common/Icon";
import { askText } from "@/components/ui/dialogUtils";
import { short } from "@/lib/html";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { openContextMenu } from "@/interactions/contextMenu";
import { branchOrder, syncInfo } from "@/model/graph";
import { layout } from "@/model/layout";
import { saveSettings } from "@/components/pages/main/sections/dialogs/settingsUtils";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";

const PULL_OPTIONS = [{ value: "merge", label: "merge" }, { value: "rebase", label: "rebase" }] as const;

const checkout = (b: string) => void run({ op: "checkout", args: [b], summary: `${b} 로 전환` });

/** 사이드바: 저장소 · 브랜치 목록 (앞섬/뒤처짐, pull 배지) · 새 브랜치 · pull 방식 */
const SidebarSection = ({ ui, repo }: UseMainLogicResult) => {
  const lanes = layout(repo).lanes;
  const colorOf = (b: string) => lanes.find((l) => l.name === b)?.color || "var(--lane-remote)";

  // 캔버스의 이름표 더블클릭도 checkout
  useEffect(() => {
    const onDbl = (e: MouseEvent) => {
      const el = (e.target as Element).closest<HTMLElement>("#graph .ref.local[data-branch]");
      if (el && el.dataset.branch !== store.repo.head) checkout(el.dataset.branch!);
    };
    document.addEventListener("dblclick", onDbl);
    return () => document.removeEventListener("dblclick", onDbl);
  }, []);

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
    const name = await askText("새 브랜치 이름", "feat/", `${from} 에서 새 브랜치를 만들고 전환합니다 (git switch -c).`);
    if (name) void run({ op: "switchCreate", args: [name], summary: `${from} 에서 새 브랜치 ${name} 를 만들고 전환` });
  };

  return (
    <>
      <h3>저장소</h3>
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
                className={`br${isHead ? " head" : ""}`}
                data-checkout={b}
                role="button"
                tabIndex={0}
                aria-label={`브랜치 ${b}${isHead ? ", 체크아웃됨" : ""}`}
                title="더블클릭·Enter: checkout · 오른쪽 클릭·Shift+F10: 메뉴"
                onDoubleClick={() => { if (!isHead) checkout(b); }}
                onKeyDown={(e) => handleRowKey(e, b)}
              >
                <span className="dot" style={{ background: colorOf(b) }} />
                {isHead && "◉ "}{b}
                {wt && <span className="badge wt" title={`${wt.path} 에서 체크아웃 중 — 여기서는 체크아웃할 수 없습니다`}>다른 폴더</span>}
                {!remote
                  ? <span className="badge">로컬</span>
                  : behind
                    ? <button type="button" className="badge pull" title={`클릭: pull (${ui.pullMode})`} onClick={() => void run({ op: "pull", args: [b, ui.pullMode], summary: `${b} pull (${ui.pullMode})` })}>{text} pull</button>
                    : <span className="badge">{text}</span>}
              </div>
            );
          })}
          {!repo.head && repo.detached && (
            <div className="detached-note">브랜치 없이 <code>{short(repo.detached)}</code> 를 보는 중입니다. 여기서 이어서 작업하려면 새 브랜치를 만드세요.</div>
          )}
        </div>
      </div>
      <div className="repo-tools">
        <button type="button" id="new-branch" className="small" title="git switch -c" onClick={() => void handleNewBranch()}>새 브랜치</button>
        <span className="muted">pull</span>
        <Dropdown id="pull-mode" label="pull 방식" value={ui.pullMode} options={[...PULL_OPTIONS]} onChange={(v) => void saveSettings({ pullMode: v })} />
      </div>
    </>
  );
};

export default SidebarSection;
