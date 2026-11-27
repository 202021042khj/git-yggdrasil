import "./OpBannerSection.css";

import { useEffect } from "react";
import { confirmAction } from "@/components/ui/dialogUtils";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { OP_CMD } from "@/constants/ops";
import { t } from "@shared/i18n/i18n";
import type { BisectState, RepoState } from "@shared/types/repo";

type OpKind = "continue" | "skip" | "abort";
const OP = { continue: "continueOp", skip: "skipOp", abort: "abortOp" } as const;
const LABEL_KEY = { continue: "op.continue", skip: "op.skip", abort: "op.abort" } as const satisfies Record<OpKind, string>;

interface OpBannerSectionProps {
  repo: RepoState;
}

/** 진행 중 작업 배너: 충돌로 멈춘 rebase · merge · cherry-pick · revert, 커밋 나누기 */
const OpBannerSection = ({ repo }: OpBannerSectionProps) => {
  const o = repo.op;
  if (!o) return repo.bisect ? <BisectBanner b={repo.bisect} repo={repo} /> : <div id="op-banner" className="op-banner hidden" />;

  const handleOp = (kind: OpKind) => {
    if (kind === "skip" && !confirmAction(t("op.confirmSkip", { msg: o.current?.msg ?? "" }))) return;
    store.update({ selectedFile: null });
    void run({ op: OP[kind], args: [], summary: t("op.summary", { title: o.title, action: t(LABEL_KEY[kind]) }) });
  };

  if (o.kind === "split") {
    return (
      <div id="op-banner" className="op-banner">
        <span className="ob-title">✂ {o.title}</span>
        <span className="ob-step">{t("op.splitFiles", { files: (o.current?.files || []).join(", ") })}</span>
        <span>{t("op.splitHint")}</span>
        <span className="spacer" />
        <button type="button" className="primary" data-op="continue" title="git rebase --continue" onClick={() => handleOp("continue")}>{t("op.splitContinue")}</button>
        <button type="button" className="danger" data-op="abort" title="git rebase --abort" onClick={() => handleOp("abort")}>{t("op.splitAbort")}</button>
      </div>
    );
  }

  const seq = o.kind === "rebase" || o.kind === "cherry-pick" || o.kind === "am";
  const done = o.conflicts.filter((f) => o.resolved[f]).length;
  const all = done === o.conflicts.length;

  if (o.kind === "stash" && o.stash) {
    // stash 충돌: 해결하면 git 이 남겨 둔 stash 를 해시로 찾아 지우고(pop), 중단하면 적용 전으로 되돌리고 stash 는 남긴다
    const keep = o.stash.keep;
    return (
      <div id="op-banner" className="op-banner">
        <span className="ob-title">{t("op.stopped", { title: o.title })}</span>
        <span>{t("op.resolved", { done, total: o.conflicts.length })}</span>
        <span className="spacer" />
        <button type="button" className="primary" data-op="continue" disabled={!all} title={keep ? "git add" : `git stash drop ${o.stash.oid.slice(0, 7)}`} onClick={() => handleOp("continue")}>{t(keep ? "op.stashDone" : "op.stashDrop")}</button>
        <button type="button" className="danger" data-op="abort" title="git reset --merge" onClick={() => handleOp("abort")}>{t("op.stashAbort")}</button>
      </div>
    );
  }

  return (
    <div id="op-banner" className="op-banner">
      <span className="ob-title">{t("op.stopped", { title: o.title })}</span>
      {seq && <span className="ob-step">{t("op.step", { step: (o.step ?? 0) + 1, total: o.total ?? 1, msg: o.current?.msg ?? "" })}</span>}
      <span>{t("op.resolved", { done, total: o.conflicts.length })}</span>
      <span className="spacer" />
      <button type="button" className="primary" data-op="continue" disabled={!all} title={`${OP_CMD[o.kind]} --continue`} onClick={() => handleOp("continue")}>▶ {t("op.continue")}</button>
      {seq && <button type="button" data-op="skip" title={`${OP_CMD[o.kind]} --skip`} onClick={() => handleOp("skip")}>{t("op.skip")}</button>}
      <button type="button" className="danger" data-op="abort" title={`${OP_CMD[o.kind]} --abort`} onClick={() => handleOp("abort")}>✕ {t("op.abort")}</button>
    </div>
  );
};

/** bisect 배너: 지금 시험 중인 커밋에 좋음/나쁨/건너뛰기, 남은 단계, 찾으면 첫 나쁜 커밋 선택, 끝내기(reset) */
const BisectBanner = ({ b, repo }: { b: BisectState; repo: RepoState }) => {
  // 찾아낸 첫 나쁜 커밋을 한 번 골라 준다 (상세 창에 바로 보이게)
  useEffect(() => {
    if (b.first && repo.commits[b.first]) store.update({ selected: b.first, multi: [], selectedFile: null });
  }, [b.first, repo.commits]);

  const short = (id: string) => id.slice(0, 7);
  const msgOf = (id: string) => repo.commits[id]?.msg ?? "";
  const original = /^[0-9a-f]{40}$/.test(b.original) ? short(b.original) : b.original;
  const mark = (kind: "good" | "bad" | "skip") =>
    void run({ op: "bisectMark", args: [kind, null], summary: t("op.bisectSummary", { action: `${kind} ${b.current ? short(b.current) : "HEAD"}` }) });
  const reset = () => void run({ op: "bisectReset", args: [], summary: t("op.bisectSummary", { action: t("op.bisectReset", { original }) }) });
  const testing = !b.first && b.bad && b.good.length > 0 && b.current;

  let status: string;
  if (b.first) status = t("op.bisectFound", { commit: short(b.first), msg: msgOf(b.first) });
  else if (!b.bad) status = t("op.bisectNeedBad");
  else if (!b.good.length) status = t("op.bisectNeedGood");
  else status = t("op.bisectTesting", { commit: short(b.current ?? ""), msg: msgOf(b.current ?? "") });

  return (
    <div id="op-banner" className="op-banner" data-kind="bisect">
      <span className="ob-title">{t("op.bisectTitle")}</span>
      <span>{status}</span>
      {testing && b.steps !== null && b.remaining !== null && <span className="ob-step">{t("op.bisectSteps", { steps: b.steps + 1, remaining: b.remaining + 1 })}</span>}
      <span className="spacer" />
      {testing && <>
        <button type="button" data-op="bisect-good" title="git bisect good" onClick={() => mark("good")}>{t("op.bisectGood")}</button>
        <button type="button" data-op="bisect-bad" title="git bisect bad" onClick={() => mark("bad")}>{t("op.bisectBad")}</button>
        <button type="button" data-op="bisect-skip" title="git bisect skip" onClick={() => mark("skip")}>{t("op.bisectSkip")}</button>
      </>}
      {b.first && <button type="button" data-op="bisect-show" title={`git show ${short(b.first)}`} onClick={() => store.update({ selected: b.first, multi: [], selectedFile: null })}>{t("op.bisectShow")}</button>}
      <button type="button" className={b.first ? "primary" : "danger"} data-op="bisect-reset" title={`git bisect reset — ${t("op.bisectResetHint")}`} onClick={reset}>{t("op.bisectReset", { original })}</button>
    </div>
  );
};

export default OpBannerSection;
