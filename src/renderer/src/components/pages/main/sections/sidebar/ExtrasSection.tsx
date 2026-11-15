import "./ExtrasSection.css";

import { confirmAction } from "@/components/ui/dialogUtils";
import { short } from "@/lib/html";
import { run } from "@/app/actions";
import { open } from "@/app/repoSession";
import type { RepoState, SubmoduleInfo, WorktreeInfo } from "@shared/types/repo";

const SUB_STATE: Record<SubmoduleInfo["state"], [string, string]> = {
  ok: ["", ""],
  uninitialized: ["받지 않음", "wait"],
  modified: ["기록과 다른 커밋", "wait"],
  conflict: ["충돌", "bad"],
};

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;
const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, "")}/${b}`;

interface ExtrasSectionProps {
  repo: RepoState;
}

/** 서브모듈 · worktree · Git LFS 안내 (사이드바). 셋 다 없으면 그리지 않는다 */
const ExtrasSection = ({ repo }: ExtrasSectionProps) => {
  const wts = repo.worktrees ?? [];
  const subs = repo.submodules ?? [];
  const pending = subs.filter((m) => m.state !== "ok").length;
  if (wts.length <= 1 && !subs.length && !repo.lfs) return null;

  const removeWorktree = (w: WorktreeInfo) => {
    if (!w.prunable && !confirmAction(`worktree ${w.path} 를 지울까요?\n폴더가 지워지고 ${w.branch ?? "이 체크아웃"} 은(는) 다른 곳에서 체크아웃할 수 있게 됩니다. 브랜치와 커밋은 그대로 남습니다.`)) return;
    void run({ op: "worktreeRemove", args: [w.path], summary: `worktree ${base(w.path)} ${w.prunable ? "정리" : "지우기"}` });
  };

  return (
    <section id="extras-box" className="extras-box" aria-label="서브모듈과 worktree">
      <div id="extras-body">
        {wts.length > 1 && (
          <>
            <h3>worktree</h3>
            {wts.map((w) => {
              const badges = [w.current && "지금 연 곳", w.main && "원래 저장소", w.locked && "잠김", w.prunable && "폴더 없음"].filter(Boolean) as string[];
              return (
                <div key={w.path} className="ex-row" title={w.path}>
                  <span className="ex-main">
                    <span className="ex-name">{base(w.path)}</span>
                    <span className="muted ex-sub">{w.branch ? w.branch : `브랜치 없음 ${short(w.head)}`}{badges.map((b) => ` · ${b}`).join("")}</span>
                  </span>
                  {!w.current && !w.prunable && <button type="button" className="small" onClick={() => void open(window.gitApi.open(w.path))}>열기</button>}
                  {!w.main && !w.current && <button type="button" className="small" onClick={() => removeWorktree(w)}>{w.prunable ? "정리" : "지우기"}</button>}
                </div>
              );
            })}
          </>
        )}
        {!!subs.length && (
          <>
            <div className="pr-head">
              <h3>서브모듈</h3>
              {!!pending && <button type="button" className="small" onClick={() => void run({ op: "submoduleUpdate", args: [null], summary: "서브모듈 전부 받기" })}>전부 맞추기</button>}
            </div>
            {subs.map((m) => {
              const [label, cls] = SUB_STATE[m.state];
              return (
                <div key={m.path} className="ex-row" title={m.url || m.path}>
                  <span className="ex-main">
                    <span className="ex-name">{m.path}</span>
                    <span className="muted ex-sub">
                      {short(m.sha)}{m.describe && ` (${m.describe})`}
                      {label && <> · <span className={`pr-badge ${cls}`}>{label}</span></>}
                    </span>
                  </span>
                  {m.state !== "ok" && <button type="button" className="small" onClick={() => void run({ op: "submoduleUpdate", args: [m.path], summary: `서브모듈 ${m.path} 받기` })}>{m.state === "uninitialized" ? "받기" : "맞추기"}</button>}
                  {m.state !== "uninitialized" && repo.root && <button type="button" className="small" onClick={() => void open(window.gitApi.open(join(repo.root!, m.path)))}>열기</button>}
                </div>
              );
            })}
          </>
        )}
        {repo.lfs && (repo.lfs.installed
          ? <p className="muted ex-note">Git LFS 파일 {repo.lfs.files.length}개 (파일 트리에 LFS 표시)</p>
          : <p className="ex-note warn">이 저장소는 Git LFS 를 씁니다. git-lfs 가 설치되어 있지 않아 큰 파일이 실제 내용 대신 포인터로 보입니다. 터미널에서 <code>brew install git-lfs</code> 와 <code>git lfs install</code> 을 실행한 뒤 다시 여세요.</p>)}
      </div>
    </section>
  );
};

export default ExtrasSection;
