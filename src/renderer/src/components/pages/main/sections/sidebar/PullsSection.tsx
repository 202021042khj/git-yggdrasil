import "./PullsSection.css";

import { useEffect, type MouseEvent } from "react";

import useSmallStore from "@/hooks/useSmallStore";
import { openMenu } from "@/components/ui/menuUtils";
import { relTime } from "@/lib/time";
import { run } from "@/app/actions";
import { loadPulls, pullsStore } from "@/components/pages/main/sections/sidebar/pullsUtils";
import type { GhChecks, GhPull, GhReview } from "@shared/types/ipc";
import type { RepoState } from "@shared/types/repo";

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

interface PullsSectionProps {
  repo: RepoState;
  hasRepo: boolean;
}

/** 열린 Pull Request 목록: 리뷰·검사 상태, 브라우저에서 열기, 받아서 체크아웃 */
const PullsSection = ({ repo, hasRepo }: PullsSectionProps) => {
  const { list, loadedFor, loading, error, loggedIn } = useSmallStore(pullsStore);
  const hasGithub = (repo.remoteList || []).some((r) => /github\.com[:/]/.test(r.url));
  const visible = hasRepo && hasGithub && loggedIn;

  useEffect(() => {
    if (visible && loadedFor !== (repo.root ?? null) && !loading) void loadPulls();
  }, [visible, loadedFor, loading, repo.root]);

  if (!visible) return null;

  const handleOpen = (p: GhPull, e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const remote = list?.remote ?? "origin";
    openMenu(r.left + 12, r.bottom, `#${p.number} ${p.title}`, [
      { label: "브라우저에서 열기", cmd: p.url, onPick: () => void window.ghApi.openUrl(p.url) },
      {
        label: repo.branches[`pr/${p.number}`] ? `pr/${p.number} 최신으로 받아 체크아웃` : `받아서 pr/${p.number} 로 체크아웃`,
        cmd: `git fetch ${remote} pull/${p.number}/head && git switch pr/${p.number}`,
        onPick: () => void run({ op: "checkoutPull", args: [p.number, remote], summary: `PR #${p.number} 받아서 체크아웃` }),
      },
    ]);
  };

  return (
    <section id="pr-box" className="pr-box" aria-labelledby="pr-title">
      <div className="pr-head">
        <h3 id="pr-title">Pull Request</h3>
        <button type="button" id="pr-refresh" className="small" title="GitHub 에서 다시 불러오기" onClick={() => void loadPulls()}>새로고침</button>
      </div>
      <div id="pr-list" className="pr-list">
        {loading && !list ? <p className="muted">불러오는 중…</p>
          : error ? <p className="muted">{error}</p>
          : !list?.pulls.length ? <p className="muted">열린 PR 이 없습니다.</p>
          : list.pulls.map((p) => {
            const review = p.review ? REVIEW[p.review] : null;
            const checks = p.checks ? CHECKS[p.checks] : null;
            const local = repo.branches[`pr/${p.number}`] ? ` · 로컬 pr/${p.number}` : "";
            return (
              <button key={p.number} type="button" className="pr-row" aria-haspopup="menu" onClick={(e) => handleOpen(p, e)}>
                <span className="pr-line1">
                  <span className="pr-no">#{p.number}</span>
                  <span className="pr-t">{p.title}</span>
                  {checks && <span className={`pr-badge ${checks[1]}`} role="img" title={checks[2]} aria-label={checks[2]}>{checks[0]}</span>}
                </span>
                <span className="pr-line2">
                  {p.draft && <span className="pr-badge">초안</span>}
                  {review && <span className={`pr-badge ${review[1]}`}>{review[0]}</span>}
                  <span className="muted">{p.head} → {p.base} · {p.author} · {relTime(Date.parse(p.updated))}{local}</span>
                </span>
              </button>
            );
          })}
      </div>
    </section>
  );
};

export default PullsSection;
