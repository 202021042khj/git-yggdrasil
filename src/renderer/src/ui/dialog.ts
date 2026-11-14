// 앱 안 입력창 (Electron 은 window.prompt 를 지원하지 않는다)
import { byId } from "@/lib/dom";

/** 텍스트 입력. 취소하면 null */
export function askText(title: string, value = "", hint = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const d = byId<HTMLDialogElement>("ask");
    const input = byId<HTMLInputElement>("ask-input");
    byId("ask-title").textContent = title;
    byId("ask-hint").textContent = hint;
    input.value = value;
    d.returnValue = "";
    d.onclose = () => resolve(d.returnValue === "ok" ? input.value.trim() : null);
    // Enter 는 항상 "확인" 으로 처리한다 (브라우저마다 기본 버튼 판정이 달라서 직접 처리)
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        d.close("ok");
      }
    };
    d.showModal();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

/** 예/아니오 확인 (Electron 은 window.confirm 은 지원한다) */
export const confirmAction = (message: string) => window.confirm(message);
