import "./ExtrasSection.css";

import { confirmAction } from "@/components/ui/dialogUtils";
import { short } from "@/lib/html";
import { run } from "@/app/actions";
import { open } from "@/app/repoSession";
import { t, type MessageKey } from "@shared/i18n/i18n";
import RichText from "@/components/common/RichText";
import type { RepoState, SubmoduleInfo, WorktreeInfo } from "@shared/types/repo";

const SUB_STATE: Record<SubmoduleInfo["state"], [MessageKey | null, string]> = {
  ok: [null, ""],
  uninitialized: ["ex.sub.uninitialized", "wait"],
  modified: ["ex.sub.modified", "wait"],
  conflict: ["ex.sub.conflict", "bad"],
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
    if (!w.prunable && !confirmAction(w.branch ? t("ex.wtConfirm", { path: w.path, branch: w.branch }) : t("ex.wtConfirmDetached", { path: w.path }))) return;
    void run({ op: "worktreeRemove", args: [w.path], summary: w.prunable ? t("ex.wtPrune", { name: base(w.path) }) : t("ex.wtRemove", { name: base(w.path) }) });
  };

  return (
    <section id="extras-box" className="extras-box" aria-label={t("ex.aria")}>
      <div id="extras-body">
        {wts.length > 1 && (
          <>
            <h3>worktree</h3>
            {wts.map((w) => {
              const badges = [w.current && t("ex.badge.current"), w.main && t("ex.badge.main"), w.locked && t("ex.badge.locked"), w.prunable && t("ex.badge.missing")].filter(Boolean) as string[];
              return (
                <div key={w.path} className="ex-row" title={w.path}>
                  <span className="ex-main">
                    <span className="ex-name">{base(w.path)}</span>
                    <span className="muted ex-sub">{w.branch ? w.branch : t("ex.detached", { id: short(w.head) })}{badges.map((b) => ` · ${b}`).join("")}</span>
                  </span>
                  {!w.current && !w.prunable && <button type="button" className="small" onClick={() => void open(window.gitApi.open(w.path))}>{t("ex.open")}</button>}
                  {!w.main && !w.current && <button type="button" className="small" onClick={() => removeWorktree(w)}>{w.prunable ? t("ex.prune") : t("ex.remove")}</button>}
                </div>
              );
            })}
          </>
        )}
        {!!subs.length && (
          <>
            <div className="pr-head">
              <h3>{t("ex.submodules")}</h3>
              {!!pending && <button type="button" className="small" onClick={() => void run({ op: "submoduleUpdate", args: [null], summary: t("ex.subUpdateAll") })}>{t("ex.syncAll")}</button>}
            </div>
            {subs.map((m) => {
              const [labelKey, cls] = SUB_STATE[m.state];
              const label = labelKey && t(labelKey);
              return (
                <div key={m.path} className="ex-row" title={m.url || m.path}>
                  <span className="ex-main">
                    <span className="ex-name">{m.path}</span>
                    <span className="muted ex-sub">
                      {short(m.sha)}{m.describe && ` (${m.describe})`}
                      {label && <> · <span className={`pr-badge ${cls}`}>{label}</span></>}
                    </span>
                  </span>
                  {m.state !== "ok" && <button type="button" className="small" onClick={() => void run({ op: "submoduleUpdate", args: [m.path], summary: t("ex.subUpdate", { path: m.path }) })}>{m.state === "uninitialized" ? t("ex.fetch") : t("ex.sync")}</button>}
                  {m.state !== "uninitialized" && repo.root && <button type="button" className="small" onClick={() => void open(window.gitApi.open(join(repo.root!, m.path)))}>{t("ex.open")}</button>}
                </div>
              );
            })}
          </>
        )}
        {repo.lfs && (repo.lfs.installed
          ? <p className="muted ex-note">{t("ex.lfsFiles", { n: repo.lfs.files.length })}</p>
          : <p className="ex-note warn"><RichText text={t("ex.lfsMissing")} /></p>)}
      </div>
    </section>
  );
};

export default ExtrasSection;
