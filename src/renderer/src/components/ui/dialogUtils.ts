// 앱 안 입력창 · 알림창 (Electron 은 window.prompt 를 지원하지 않는다). 함수로 열고 <AskDialog /> · <NoticeDialog /> 가 그린다.
import { createStore } from "@/lib/createStore";
import { hideToast } from "@/components/ui/toastUtils";

export interface AskState {
  title: string;
  value: string;
  hint: string;
  resolve: (v: string | null) => void;
}

export interface NoticeState {
  title: string;
  body: string;
  detail: string;
}

export const askStore = createStore<AskState | null>(null);
export const noticeStore = createStore<NoticeState | null>(null);

/** 텍스트 입력. 취소하면 null */
export const askText = (title: string, value = "", hint = ""): Promise<string | null> =>
  new Promise((resolve) => {
    askStore.get()?.resolve(null); // 이미 떠 있던 질문은 취소로
    askStore.set({ title, value, hint, resolve });
  });

/** 원인과 해결 방법을 보여 주는 알림 (토스트로는 짧아서 읽기 어려운 안내) */
export const showNotice = (title: string, body: string, detail = "") => {
  hideToast();
  noticeStore.set({ title, body, detail });
};

/** 예/아니오 확인 (Electron 은 window.confirm 은 지원한다) */
export const confirmAction = (message: string) => window.confirm(message);
