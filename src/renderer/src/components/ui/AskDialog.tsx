import "./Dialog.css";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import useModal from "@/hooks/useModal";
import useSmallStore from "@/hooks/useSmallStore";
import { askStore } from "@/components/ui/dialogUtils";
import { t } from "@shared/i18n/i18n";

/** askText() 로 여는 한 줄 입력창 */
const AskDialog = () => {
  const ask = useSmallStore(askStore);
  const [value, setValue] = useState("");
  const answer = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ref = useModal(!!ask, () => {
    const cur = askStore.get();
    if (!cur) return;
    askStore.set(null);
    cur.resolve(answer.current);
  });

  useEffect(() => {
    if (!ask) return;
    answer.current = null;
    setValue(ask.value);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      el?.setSelectionRange(ask.value.length, ask.value.length);
    });
  }, [ask]);

  const finish = (ok: boolean) => {
    answer.current = ok ? value.trim() : null;
    ref.current?.close();
  };

  // Enter 는 항상 "확인" (브라우저마다 기본 버튼 판정이 달라서 직접 처리)
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    finish(true);
  };

  return (
    <dialog id="ask" ref={ref} className="ask">
      <form method="dialog" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="ask-input" id="ask-title">{ask?.title}</label>
        {ask?.hint && <p id="ask-hint" className="muted">{ask.hint}</p>}
        <input id="ask-input" ref={inputRef} type="text" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={handleKeyDown} />
        <div className="ask-actions">
          <button type="button" className="primary" onClick={() => finish(true)}>{t("common.ok")}</button>
          <button type="button" onClick={() => finish(false)}>{t("common.cancel")}</button>
        </div>
      </form>
    </dialog>
  );
};

export default AskDialog;
