import "./OpBannerSection.css";

import { confirmAction } from "@/components/ui/dialogUtils";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { OP_CMD } from "@/constants/ops";
import { t } from "@shared/i18n/i18n";
import type { RepoState } from "@shared/types/repo";

type OpKind = "continue" | "skip" | "abort";
const OP = { continue: "continueOp", skip: "skipOp", abort: "abortOp" } as const;
const LABEL_KEY = { continue: "op.continue", skip: "op.skip", abort: "op.abort" } as const satisfies Record<OpKind, string>;

interface OpBannerSectionProps {
  repo: RepoState;
}

/** 진행 중 작업 배너: 충돌로 멈춘 rebase · merge · cherry-pick · revert, 커밋 나누기 */
const OpBannerSection = ({ repo }: OpBannerSectionProps) => {
  const o = repo.op;
  if (!o) return <div id="op-banner" className="op-banner hidden" />;

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

  const seq = o.kind === "rebase" || o.kind === "cherry-pick";
  const done = o.conflicts.filter((f) => o.resolved[f]).length;
  const all = done === o.conflicts.length;

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

export default OpBannerSection;
