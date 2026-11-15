// 진행 중 작업 배너: 충돌로 멈춘 rebase · merge · cherry-pick · revert, 커밋 나누기
import "./OpBannerSection.css";
import { run } from "@/app/actions";
import { store } from "@/app/store";
import { OP_CMD } from "@/constants/ops";
import { byId } from "@/lib/dom";
import { esc } from "@/lib/html";
import { confirmAction } from "@/ui/dialog";

export function renderOpBanner(): void {
  const o = store.repo.op, b = byId("op-banner");
  if (!o) { b.classList.add("hidden"); return; }
  b.classList.remove("hidden");
  if (o.kind === "split") {
    b.innerHTML = `
      <span class="ob-title">✂ ${esc(o.title)}</span>
      <span class="ob-step">변경 파일: ${esc((o.current?.files || []).join(", "))}</span>
      <span>파일이나 변경 덩어리를 골라 여러 번에 나눠 커밋한 뒤 계속을 누르세요.</span>
      <span class="spacer"></span>
      <button type="button" class="primary" data-op="continue" title="git rebase --continue">▶ 계속 (뒤 커밋 다시 올리기)</button>
      <button type="button" class="danger" data-op="abort" title="git rebase --abort">✕ 중단 (나누기 전으로)</button>`;
    return;
  }
  const seq = o.kind === "rebase" || o.kind === "cherry-pick";
  const done = o.conflicts.filter((f) => o.resolved[f]).length;
  const all = done === o.conflicts.length;
  b.innerHTML = `
    <span class="ob-title">⏸ ${esc(o.title)} — 충돌로 멈춤</span>
    ${seq ? `<span class="ob-step">커밋 ${(o.step ?? 0) + 1}/${o.total ?? 1} "${esc(o.current?.msg ?? "")}" 적용 중</span>` : ""}
    <span>충돌 파일 ${done}/${o.conflicts.length} 해결</span>
    <span class="spacer"></span>
    <button type="button" class="primary" data-op="continue" ${all ? "" : "disabled"} title="${OP_CMD[o.kind]} --continue">▶ 계속</button>
    ${seq ? `<button type="button" data-op="skip" title="${OP_CMD[o.kind]} --skip">이 커밋 건너뛰기</button>` : ""}
    <button type="button" class="danger" data-op="abort" title="${OP_CMD[o.kind]} --abort">✕ 중단 (시작 전으로)</button>`;
}

export function mountOpBanner(): void {
  byId("op-banner").addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>("[data-op]");
    const o = store.repo.op;
    if (!btn || btn.disabled || !o) return;
    const kind = btn.dataset.op as "continue" | "skip" | "abort";
    if (kind === "skip" && !confirmAction(`"${o.current?.msg}" 커밋을 버리고 다음으로 넘어갈까요?`)) return;
    store.update({ selectedFile: null });
    const op = { continue: "continueOp", skip: "skipOp", abort: "abortOp" } as const;
    const label = { continue: "계속", skip: "이 커밋 건너뛰기", abort: "중단 (시작 전으로)" }[kind];
    void run({ op: op[kind], args: [], summary: `${o.title} — ${label}` });
  });
}
