import "./OpBannerSection.css";

import { confirmAction } from "@/components/ui/dialogUtils";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { OP_CMD } from "@/constants/ops";
import type { RepoState } from "@shared/types/repo";

type OpKind = "continue" | "skip" | "abort";
const OP = { continue: "continueOp", skip: "skipOp", abort: "abortOp" } as const;
const LABEL: Record<OpKind, string> = { continue: "계속", skip: "이 커밋 건너뛰기", abort: "중단 (시작 전으로)" };

interface OpBannerSectionProps {
  repo: RepoState;
}

/** 진행 중 작업 배너: 충돌로 멈춘 rebase · merge · cherry-pick · revert, 커밋 나누기 */
const OpBannerSection = ({ repo }: OpBannerSectionProps) => {
  const o = repo.op;
  if (!o) return <div id="op-banner" className="op-banner hidden" />;

  const handleOp = (kind: OpKind) => {
    if (kind === "skip" && !confirmAction(`"${o.current?.msg}" 커밋을 버리고 다음으로 넘어갈까요?`)) return;
    store.update({ selectedFile: null });
    void run({ op: OP[kind], args: [], summary: `${o.title} — ${LABEL[kind]}` });
  };

  if (o.kind === "split") {
    return (
      <div id="op-banner" className="op-banner">
        <span className="ob-title">✂ {o.title}</span>
        <span className="ob-step">변경 파일: {(o.current?.files || []).join(", ")}</span>
        <span>파일이나 변경 덩어리를 골라 여러 번에 나눠 커밋한 뒤 계속을 누르세요.</span>
        <span className="spacer" />
        <button type="button" className="primary" data-op="continue" title="git rebase --continue" onClick={() => handleOp("continue")}>▶ 계속 (뒤 커밋 다시 올리기)</button>
        <button type="button" className="danger" data-op="abort" title="git rebase --abort" onClick={() => handleOp("abort")}>✕ 중단 (나누기 전으로)</button>
      </div>
    );
  }

  const seq = o.kind === "rebase" || o.kind === "cherry-pick";
  const done = o.conflicts.filter((f) => o.resolved[f]).length;
  const all = done === o.conflicts.length;

  return (
    <div id="op-banner" className="op-banner">
      <span className="ob-title">⏸ {o.title} — 충돌로 멈춤</span>
      {seq && <span className="ob-step">커밋 {(o.step ?? 0) + 1}/{o.total ?? 1} "{o.current?.msg ?? ""}" 적용 중</span>}
      <span>충돌 파일 {done}/{o.conflicts.length} 해결</span>
      <span className="spacer" />
      <button type="button" className="primary" data-op="continue" disabled={!all} title={`${OP_CMD[o.kind]} --continue`} onClick={() => handleOp("continue")}>▶ 계속</button>
      {seq && <button type="button" data-op="skip" title={`${OP_CMD[o.kind]} --skip`} onClick={() => handleOp("skip")}>이 커밋 건너뛰기</button>}
      <button type="button" className="danger" data-op="abort" title={`${OP_CMD[o.kind]} --abort`} onClick={() => handleOp("abort")}>✕ 중단 (시작 전으로)</button>
    </div>
  );
};

export default OpBannerSection;
