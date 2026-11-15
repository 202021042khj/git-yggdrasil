import "./WorkingSection.css";

import { useRef, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";

import Icon, { type IconName } from "@/components/common/Icon";
import { toast } from "@/components/ui/toastUtils";
import { blocked, run, runPreviewed } from "@/app/actions";
import { store } from "@/app/store";
import { isError, preview } from "@/model/preview";
import type { UseMainLogicResult } from "@/hooks/useMainLogic";

interface TreeNode {
  name: string;
  path: string;
  kids: Map<string, TreeNode>;
  file: boolean;
}

const buildTree = (rootName: string, paths: string[]): TreeNode => {
  const root: TreeNode = { name: rootName, path: "", kids: new Map(), file: false };
  for (const p of paths) {
    let node = root;
    p.split("/").forEach((part, i, arr) => {
      const path = arr.slice(0, i + 1).join("/");
      if (!node.kids.has(part)) node.kids.set(part, { name: part, path, kids: new Map(), file: i === arr.length - 1 });
      node = node.kids.get(part)!;
    });
  }
  return root;
};
const leafFiles = (n: TreeNode): string[] => (n.file ? [n.path] : [...n.kids.values()].flatMap(leafFiles));
const sortKids = (n: TreeNode) => [...n.kids.values()].sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));

const stage = (path: string, checked: boolean) => {
  const to = checked ? "staged" : "unstaged";
  void run({ op: "stageFiles", args: [[path], to], summary: `${path || "전체"} ${to === "staged" ? "stage" : "unstage"}` });
};

const discard = (path: string) => {
  const res = preview("discard", store.repo, [[path]]);
  if (isError(res)) toast(res.error);
  else void runPreviewed("discard", [[path]], res);
};

const toggleFolder = (path: string) => {
  const collapsed = new Set(store.ui.collapsed);
  if (collapsed.has(path)) collapsed.delete(path);
  else collapsed.add(path);
  store.update({ collapsed });
};

/** 작업 영역: 커밋 메시지 칸 · 변경 묶음 손잡이 · 폴더 트리 (체크 = stage, ↶ = 버리기) */
const WorkingSection = ({ ui, repo }: UseMainLogicResult) => {
  // 메시지 칸은 드래그(interactions/drag) 도 읽고 비우므로 DOM 값을 그대로 쓴다
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const w = repo.working;
  const staged = new Set(w.staged), unstaged = new Set(w.unstaged);
  const changed = new Set([...w.staged, ...w.unstaged]);
  const conflicted = new Set(w.conflicted);
  const resolved = repo.op?.resolved ?? {};
  const lfsSet = new Set(repo.lfs?.files ?? []);
  const subSet = new Set((repo.submodules ?? []).map((m) => m.path));
  const committed = new Set(repo.files);
  const root = buildTree(repo.repoName || "", [...new Set([...repo.files, ...changed, ...conflicted])].sort());

  const commitFromBox = async () => {
    if (blocked("commitTo")) return;
    const box = msgRef.current!;
    const msg = box.value.trim();
    if (!msg) { box.focus(); toast("커밋 메시지를 입력하세요."); return; }
    const branch = repo.head || "HEAD";
    const res = preview("commitTo", repo, [branch, msg, undefined]);
    if (isError(res)) { toast(res.error); return; }
    box.value = "";
    await run({ op: "commitTo", args: [branch, msg, undefined], summary: res.summary });
  };

  const handleMsgKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    void commitFromBox();
  };

  const handleRowClick = (e: MouseEvent<HTMLDivElement>, n: TreeNode) => {
    if (!n.file || (e.target as Element).closest("input, button, .chev")) return;
    store.update({ selected: null, selectedFile: { path: n.path, commit: null }, detailTab: "diff" });
  };

  const rows: ReactElement[] = [];
  const walk = (n: TreeNode, depth: number) => {
    const files = leafFiles(n);
    const ch = files.filter((f) => changed.has(f));
    const fullyStaged = ch.filter((f) => staged.has(f) && !unstaged.has(f));
    const partly = ch.filter((f) => staged.has(f) && unstaged.has(f));
    const cf = files.filter((f) => conflicted.has(f));
    if (ui.onlyChanged && !ch.length && !cf.length && n.path !== "") return;
    const isOpen = !ui.collapsed.has(n.path);
    const allStaged = !!ch.length && fullyStaged.length === ch.length;
    const someStaged = !allStaged && (!!fullyStaged.length || !!partly.length);
    const isCf = n.file && conflicted.has(n.path);
    const stagedCount = fullyStaged.length + partly.length;
    const active = ui.selectedFile && !ui.selectedFile.commit && ui.selectedFile.path === n.path;
    const icon: IconName = n.path === "" ? "box" : n.file ? "file" : "folder";
    const cls = ["ft-row", n.file ? "file" : "folder", ch.length || cf.length ? "" : "clean", isCf ? (resolved[n.path] ? "conflict resolved" : "conflict") : "", active ? "active" : ""].filter(Boolean).join(" ");

    rows.push(
      // biome-ignore lint/a11y/noStaticElementInteractions: 행 클릭은 파일 diff 보기. 키보드로는 ⌘K 찾기에서 파일을 연다
      // biome-ignore lint/a11y/useKeyWithClickEvents: 위와 같음
      <div
        key={n.path || "/"}
        className={cls}
        data-drag={ch.length ? "file" : undefined}
        data-file={ch.length ? n.path : undefined}
        data-path={n.path}
        style={{ paddingLeft: depth * 12 + 4 }}
        title={n.path || "저장소 루트"}
        onClick={(e) => handleRowClick(e, n)}
      >
        {n.file
          ? <span className="chev" />
          : <button type="button" className="chev" aria-expanded={isOpen} aria-label={`${n.name} ${isOpen ? "접기" : "펼치기"}`} onClick={() => toggleFolder(n.path)}>{isOpen ? "▾" : "▸"}</button>}
        <input
          type="checkbox"
          disabled={!ch.length}
          checked={allStaged}
          ref={(el) => { if (el) el.indeterminate = someStaged; }}
          aria-label={`${n.path || "전체"} stage`}
          onChange={(e) => stage(n.path, e.target.checked)}
        />
        <span className="name">
          <Icon name={icon} />{n.name}
          {n.file && lfsSet.has(n.path) && <> <span className="tag-mini" title="Git LFS 로 관리하는 파일">LFS</span></>}
          {n.file && subSet.has(n.path) && <> <span className="tag-mini" title="서브모듈 (다른 저장소)">서브모듈</span></>}
        </span>
        {isCf
          ? <span className={`st ${resolved[n.path] ? "S" : "C"}`}>{resolved[n.path] ? "✓" : "C"}</span>
          : n.file
            ? !!ch.length && <span className={`st ${committed.has(n.path) ? "M" : "U"}`} title={partly.length ? "일부만 stage 됨" : ""}>{partly.length ? "◐" : committed.has(n.path) ? "M" : "U"}</span>
            : (!!ch.length || !!cf.length) && (
              <span className="st">
                {!!cf.length && <><span className="st C">⚠{cf.length}</span> </>}
                {!!ch.length && `${stagedCount ? `${stagedCount}/` : ""}${ch.length}`}
              </span>
            )}
        {!!ch.length && <button type="button" className="discard" title="변경 버리기 (git restore)" aria-label={`${n.path || "전체"} 변경 버리기`} onClick={() => discard(n.path)}>↶</button>}
      </div>,
    );
    if (!n.file && isOpen) sortKids(n).forEach((k) => walk(k, depth + 1));
  };
  walk(root, 0);

  const target = repo.head || (repo.detached ? "HEAD" : "");
  const handleText = w.staged.length ? `Staged ${w.staged.length}개 끌기` : w.unstaged.length ? `변경 ${w.unstaged.length}개 모두 끌기` : "변경 없음";
  const commitText = !changed.size ? "커밋할 변경 없음"
    : `${repo.head || "브랜치 없이(HEAD)"} 에 커밋 (${w.staged.length ? `staged ${w.staged.length}개` : `변경 전체 ${changed.size}개`})`;

  return (
    <>
      <h3>작업 영역</h3>
      <div id="working" className="working-card" data-drop="working">
        <textarea id="commit-msg" ref={msgRef} rows={2} aria-label="커밋 메시지" placeholder="커밋 메시지 (⌘Enter 로 커밋)" onKeyDown={handleMsgKey} />
        <button type="button" id="commit-btn" className="commit-btn" disabled={!changed.size || !target} onClick={() => void commitFromBox()}>{commitText}</button>
        <div className={`working-handle${changed.size ? "" : " empty"}`} data-drag="working" title="브랜치 이름표나 커밋에 끌어 놓기 · 오른쪽 클릭으로 메뉴">{handleText}</div>
        <div className="tree-tools">
          <span id="work-summary" className="muted">변경 {changed.size} · staged {staged.size}</span>
          <label className="muted">
            <input type="checkbox" id="only-changed" checked={ui.onlyChanged} onChange={(e) => store.update({ onlyChanged: e.target.checked })} /> 변경만
          </label>
        </div>
        <div id="file-tree" className="file-tree">{rows}</div>
        <p className="muted hint">체크하면 stage (폴더는 하위 전체). 파일이나 폴더를 브랜치 이름표에 끌면 그 경로만 커밋합니다.</p>
      </div>
    </>
  );
};

export default WorkingSection;
