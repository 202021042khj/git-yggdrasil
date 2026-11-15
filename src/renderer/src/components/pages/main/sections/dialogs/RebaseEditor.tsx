import "./RebaseEditor.css";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import Dropdown from "@/components/ui/Dropdown";
import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { toast } from "@/components/ui/toastUtils";
import { short } from "@/lib/html";
import { runPreviewed } from "@/app/actions";
import { store } from "@/app/store";
import { pushedSet } from "@/model/graph";
import { isError, preview } from "@/model/preview";
import { rebaseStore } from "@/components/pages/main/sections/dialogs/rebaseUtils";
import type { RebaseStep } from "@shared/types/ipc";

const ACTIONS: Array<{ value: RebaseStep["action"]; label: string }> = [
  { value: "pick", label: "그대로" },
  { value: "reword", label: "메시지 수정" },
  { value: "squash", label: "위 커밋에 합치기" },
  { value: "fixup", label: "위 커밋에 합치기 (메시지 버림)" },
  { value: "drop", label: "빼기" },
];

const needsMsg = (a: RebaseStep["action"]) => a === "reword" || a === "squash";

/** 커밋 정리(interactive rebase) 창: 브랜치의 커밋 순서·합치기·메시지·빼기를 한 번에 정하고 결과를 미리 본 뒤 실행 */
const RebaseEditor = () => {
  const target = useSmallStore(rebaseStore);
  const [steps, setSteps] = useState<RebaseStep[]>([]);
  const [dragFrom, setDragFrom] = useState(-1);
  const [dropAt, setDropAt] = useState(-1);
  const listRef = useRef<HTMLOListElement>(null);
  /** 순서를 바꾼 뒤 초점을 옮길 줄 · 할 일을 바꾼 뒤 메시지 칸에 초점을 줄 줄 */
  const focusNext = useRef<{ row?: number; msg?: number }>({});
  const ref = useModal(!!target, () => rebaseStore.set(null));

  const original = () => target?.ids.map((id): RebaseStep => ({ id, action: "pick" })) ?? [];
  useEffect(() => { setSteps(target ? target.ids.map((id) => ({ id, action: "pick" })) : []); }, [target]);

  useEffect(() => {
    const f = focusNext.current;
    focusNext.current = {};
    if (f.row !== undefined) listRef.current?.querySelector<HTMLElement>(`[data-i="${f.row}"] .dd-btn`)?.focus();
    if (f.msg !== undefined) listRef.current?.querySelector<HTMLTextAreaElement>(`[data-msg="${f.msg}"]`)?.focus();
  });

  if (!target) return <dialog id="rebase" ref={ref} className="ask rebase" aria-labelledby="rebase-title" />;
  const s = store.repo;
  const pushed = pushedSet(s);
  const res = preview("rebasePlan", s, [target.branch, steps]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const next = [...steps];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    focusNext.current = { row: to };
    setSteps(next);
  };

  /** squash 를 고르면 기본 메시지로 위 커밋과 이 커밋의 메시지를 이어 붙인다 */
  const defaultMsg = (i: number, action: RebaseStep["action"]) => {
    const msg = s.commits[steps[i].id].msg;
    if (action !== "squash") return msg;
    for (let j = i - 1; j >= 0; j--) {
      if (steps[j].action === "drop") continue;
      return `${steps[j].msg ?? s.commits[steps[j].id].msg}\n\n${msg}`;
    }
    return msg;
  };

  const setAction = (i: number, action: RebaseStep["action"]) => {
    focusNext.current = needsMsg(action) ? { msg: i } : {};
    setSteps(steps.map((x, k) => (k === i ? { id: x.id, action, ...(needsMsg(action) ? { msg: defaultMsg(i, action) } : {}) } : x)));
  };

  const setMsg = (i: number, msg: string) => setSteps(steps.map((x, k) => (k === i ? { ...x, msg } : x)));

  const handleRowKey = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    move(i, e.key === "ArrowUp" ? i - 1 : i + 1);
  };

  const handleRun = async () => {
    if (isError(res)) { toast(res.error); return; }
    ref.current?.close();
    await runPreviewed("rebasePlan", [target.branch, steps.map((x) => ({ ...x }))], res);
  };

  return (
    <dialog id="rebase" ref={ref} className="ask rebase" aria-labelledby="rebase-title">
      <h2 id="rebase-title">{target.branch} 커밋 정리 ({target.ids.length}개)</h2>
      <p className="muted rebase-help">위가 오래된 커밋입니다. 줄을 끌거나 ↑↓(또는 Alt+↑↓)로 순서를 바꾸고, 줄마다 할 일을 고르세요.</p>
      <ol id="rebase-list" ref={listRef} className="rebase-list">
        {steps.map((x, i) => {
          const c = s.commits[x.id];
          const cls = ["rb-row", `a-${x.action}`, dragFrom === i && "dragging-row", dropAt === i && "drop-before"].filter(Boolean).join(" ");
          return (
            <li
              key={x.id}
              className={cls}
              draggable
              data-i={i}
              onKeyDown={(e) => handleRowKey(e, i)}
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.setData("text/plain", String(i)); }}
              onDragOver={(e) => { if (dragFrom < 0) return; e.preventDefault(); setDropAt(i); }}
              onDrop={(e) => { e.preventDefault(); if (dragFrom >= 0) move(dragFrom, i); setDragFrom(-1); setDropAt(-1); }}
              onDragEnd={() => { setDragFrom(-1); setDropAt(-1); }}
            >
              <span className="rb-grip" aria-hidden="true">⋮⋮</span>
              <span className="rb-move">
                <button type="button" className="small" aria-label="위로" disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                <button type="button" className="small" aria-label="아래로" disabled={i === steps.length - 1} onClick={() => move(i, i + 1)}>↓</button>
              </span>
              <Dropdown label={`${c.msg} 에 할 일`} value={x.action} options={ACTIONS} onChange={(a) => setAction(i, a)} />
              <span className="rb-main">
                <span className="rb-msg">{c.msg}</span>
                <span className="muted rb-meta">{short(x.id)}{!!c.files.length && ` · 파일 ${c.files.length}개`}{pushed.has(x.id) && " · push 됨"}</span>
                {needsMsg(x.action) && <textarea data-msg={i} rows={x.action === "squash" ? 3 : 1} aria-label="새 메시지" value={x.msg ?? ""} onChange={(e) => setMsg(i, e.target.value)} />}
              </span>
            </li>
          );
        })}
      </ol>
      <div id="rebase-result" className="rebase-result" aria-live="polite">
        {isError(res)
          ? <p className="muted">{res.error}</p>
          : <>
            <p><b>{res.summary}</b></p>
            {!!res.conflicts.length && <p className="warn">⚠ 충돌할 수 있는 파일: {res.conflicts.join(", ")} — 체크아웃한 브랜치라면 멈춘 뒤 해결하며 진행합니다.</p>}
            {res.rewrites.some((id) => pushed.has(id)) && <p className="warn">push 된 커밋을 다시 씁니다. 이후 force push 가 필요합니다.</p>}
          </>}
      </div>
      <div className="ask-actions">
        <button type="button" id="rebase-run" className="primary" disabled={isError(res)} onClick={() => void handleRun()}>실행</button>
        <button type="button" id="rebase-reset" onClick={() => setSteps(original())}>처음대로</button>
        <button type="button" id="rebase-cancel" onClick={() => ref.current?.close()}>취소</button>
      </div>
    </dialog>
  );
};

export default RebaseEditor;
